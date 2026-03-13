from __future__ import annotations

import math
import re
import time
import uuid
from pathlib import Path

from document_engine.analyzer.element_detector import ElementDetector
from document_engine.analyzer.scoring_engine import ScoringEngine
from document_engine.analyzer.structure_detector import StructureDetector
from document_engine.analyzer.variant_matcher import VariantMatcher
from document_engine.config.item_loader import ItemLoader
from document_engine.core.layout_parser import LayoutParser
from document_engine.core.ocr_engine import OcrEngine
from document_engine.core.excel_extractor import ExcelExtractor
from document_engine.core.pdf_loader import PdfLoader
from document_engine.core.text_extractor import TextExtractor
from document_engine.model_types import LayoutZone, OcrBlock, TextBlock


class AnalyzePipeline:
    def __init__(self, config_dir: Path) -> None:
        self.item_loader = ItemLoader(config_dir)
        self.pdf_loader = PdfLoader()
        self.excel_extractor = ExcelExtractor()
        self.text_extractor = TextExtractor()
        self.layout_parser = LayoutParser()
        self.structure_detector = StructureDetector()
        self.variant_matcher = VariantMatcher()
        self.scoring_engine = ScoringEngine()

    def run(
        self,
        item_name: str,
        base64_document: str,
        ocr_mode: str = "auto",
        document_type: str = "pdf",
        excel_header_axis: str = "first_row",
    ) -> dict:
        t0 = time.perf_counter()
        item_config = self.item_loader.load_item(item_name)
        global_rules = self.item_loader.load_global_rules()
        detector = ElementDetector(global_rules)
        required_elements = item_config.get("required_elements", [])
        threshold = float(item_config.get("threshold", 0.7))

        document_id = str(uuid.uuid4())
        doc_type = document_type if document_type in {"pdf", "excel"} else "pdf"
        if doc_type == "excel":
            excel_bytes = self.excel_extractor.decode_base64_excel(base64_document)
            full_text, text_blocks, page_count = self.excel_extractor.extract(
                excel_bytes,
                header_axis=excel_header_axis,
            )
            tmp_path = None
        else:
            pdf_bytes = self.pdf_loader.decode_base64_pdf(base64_document)
            tmp_path = self.pdf_loader.persist_temp(pdf_bytes, Path("/tmp/document_engine"), f"{document_id}.pdf")
            full_text, text_blocks, page_count = self.text_extractor.extract(pdf_bytes)
            text_blocks = self._filter_watermark_text_blocks(text_blocks)
            full_text = "\n".join(block.text for block in text_blocks)
        native_text_length = len(full_text)
        ocr_used = False
        ocr_blocks = []
        requested_mode = ocr_mode if ocr_mode in {"auto", "native", "ocr"} else "auto"
        applied_mode = "native" if requested_mode == "native" else "ocr"
        ocr_attempted = False
        ocr_error: str | None = None

        if doc_type == "excel":
            applied_mode = "native"
            if requested_mode == "ocr":
                ocr_error = "OCR is not supported for Excel native files"

        zones = self.layout_parser.build_zones(text_blocks)
        signature = self.structure_detector.compute_signature(page_count, full_text, zones)
        variants = item_config.get("variant_signatures", [])
        variant_name, variant_score, variant_match = self.variant_matcher.match(signature, variants)
        detections = detector.detect(required_elements, zones, [])
        completeness_score = self.scoring_engine.compute(required_elements, detections)

        should_try_ocr = False
        if doc_type == "pdf":
            if requested_mode == "ocr":
                should_try_ocr = True
            elif requested_mode == "auto":
                should_try_ocr = self._should_retry_with_ocr(
                    full_text=full_text,
                    text_blocks=text_blocks,
                    required_elements=required_elements,
                    detections=detections,
                    completeness_score=completeness_score,
                    threshold=threshold,
                )

        if should_try_ocr:
            ocr_attempted = True
            try:
                if tmp_path is None:
                    raise RuntimeError("Missing temporary PDF path for OCR")
                ocr_engine = OcrEngine(language=item_config.get("language", "fr"))
                ocr_blocks = ocr_engine.run(tmp_path)
                ocr_blocks = self._filter_watermark_ocr_blocks(ocr_blocks)
                full_text = full_text + "\n" + "\n".join(b.text for b in ocr_blocks)
                ocr_used = len(ocr_blocks) > 0
                if requested_mode == "auto":
                    applied_mode = "ocr"
            except Exception as exc:
                ocr_used = False
                ocr_error = str(exc)
                if requested_mode == "auto":
                    applied_mode = "native"

        if ocr_blocks:
            zones.extend(self._zones_from_ocr_blocks(ocr_blocks))
        detections = detector.detect(required_elements, zones, [b.text for b in ocr_blocks])
        completeness_score = self.scoring_engine.compute(required_elements, detections)
        signature = self.structure_detector.compute_signature(page_count, full_text, zones)
        variant_name, variant_score, variant_match = self.variant_matcher.match(signature, variants)
        valid = variant_match and completeness_score >= threshold
        detected_names = {d.name for d in detections}
        total_weight = sum(float(e.get("weight", 1)) for e in required_elements) or 1.0
        detected_weight = sum(
            float(e.get("weight", 1))
            for e in required_elements
            if e.get("name") in detected_names
        )
        missing_elements = [
            e.get("name")
            for e in required_elements
            if e.get("name") not in detected_names
        ]
        excel_pairs_preview = self._excel_pairs_preview(zones) if doc_type == "excel" else []

        return {
            "document_id": document_id,
            "item": item_name,
            "item_auto_detected": False,
            "score": completeness_score,
            "valid": valid,
            "variant_detected": variant_name,
            "variant_score": variant_score,
            "threshold": threshold,
            "matched_weight_sum": round(detected_weight, 4),
            "total_weight_sum": round(total_weight, 4),
            "missing_elements": missing_elements,
            "elements_found": [
                {
                    "name": d.name,
                    "page": d.page,
                    "evidence": d.evidence,
                    "value": d.meta.get("field_value"),
                    "value_position": d.meta.get("value_position"),
                    "right_text": d.meta.get("right_text"),
                    "below_text": d.meta.get("below_text"),
                    "anchor_text": d.meta.get("anchor_text"),
                    "target_text": d.meta.get("target_text"),
                    "target_right_text": d.meta.get("target_right_text"),
                    "target_below_text": d.meta.get("target_below_text"),
                    "lines_below": d.meta.get("lines_below"),
                }
                for d in detections
            ],
            "ocr_used": ocr_used,
            "ocr_mode_requested": requested_mode,
            "ocr_mode_applied": applied_mode,
            "ocr_attempted": ocr_attempted,
            "ocr_blocks_count": len(ocr_blocks),
            "native_text_length": native_text_length,
            "ocr_error": ocr_error,
            "processing_time_ms": int((time.perf_counter() - t0) * 1000),
            "document_type": doc_type,
            "excel_pairs_preview": excel_pairs_preview,
            "signature": {
                "page_count": signature.page_count,
                "dominant_keywords": signature.dominant_keywords,
                "layout_zones": signature.layout_zones,
                "table_presence": signature.table_presence,
                "title_patterns": signature.title_patterns,
            },
        }

    def run_with_item_detection(
        self,
        base64_document: str,
        ocr_mode: str = "auto",
        document_type: str = "pdf",
        excel_header_axis: str = "first_row",
    ) -> dict:
        item_names = self.item_loader.list_items()
        if not item_names:
            raise FileNotFoundError("No item configuration found")

        best_result: dict | None = None
        best_key: tuple[float, float, float, float] | None = None
        last_error: Exception | None = None

        for item_name in item_names:
            try:
                result = self.run(
                    item_name=item_name,
                    base64_document=base64_document,
                    ocr_mode=ocr_mode,
                    document_type=document_type,
                    excel_header_axis=excel_header_axis,
                )
            except (FileNotFoundError, ValueError) as exc:
                last_error = exc
                continue

            candidate_key = self._candidate_key(result)
            if best_key is None or candidate_key > best_key:
                best_key = candidate_key
                best_result = result

        if best_result is None:
            if last_error is not None:
                raise last_error
            raise FileNotFoundError("No item configuration could analyze this document")

        best_result["item_auto_detected"] = True
        return best_result

    def _candidate_key(self, result: dict) -> tuple[float, float, float, float]:
        total_weight = float(result.get("total_weight_sum", 0.0) or 0.0)
        matched_weight = float(result.get("matched_weight_sum", 0.0) or 0.0)
        weight_ratio = matched_weight / total_weight if total_weight > 0 else 0.0
        return (
            1.0 if result.get("valid") else 0.0,
            float(result.get("score", 0.0) or 0.0),
            weight_ratio,
            float(result.get("variant_score", 0.0) or 0.0),
        )

    def _zones_from_ocr_blocks(self, ocr_blocks: list[OcrBlock]) -> list[LayoutZone]:
        zones: list[LayoutZone] = []
        for block in ocr_blocks:
            xs = [point[0] for point in block.bounding_box]
            ys = [point[1] for point in block.bounding_box]
            if not xs or not ys:
                continue
            zones.append(
                LayoutZone(
                    page=block.page,
                    zone_type="paragraph",
                    x0=min(xs),
                    y0=min(ys),
                    x1=max(xs),
                    y1=max(ys),
                    text=block.text,
                )
            )
        return zones

    def _excel_pairs_preview(self, zones: list[LayoutZone], limit: int = 40) -> list[str]:
        pairs: list[str] = []
        seen: set[str] = set()
        for zone in zones:
            text = " ".join(zone.text.split())
            if ":" not in text:
                continue
            if text in seen:
                continue
            seen.add(text)
            pairs.append(text)
            if len(pairs) >= limit:
                break
        return pairs

    def _should_retry_with_ocr(
        self,
        full_text: str,
        text_blocks: list,
        required_elements: list[dict],
        detections: list,
        completeness_score: float,
        threshold: float,
    ) -> bool:
        if len(full_text.strip()) < 200:
            return True
        if len(text_blocks) < 8:
            return True
        if not required_elements:
            return False

        missing_count = max(len(required_elements) - len(detections), 0)
        missing_ratio = missing_count / len(required_elements)
        effective_threshold = min(max(threshold, 0.45), 0.85)
        return completeness_score < effective_threshold and missing_ratio >= 0.3

    def _filter_watermark_text_blocks(self, text_blocks: list[TextBlock]) -> list[TextBlock]:
        return [block for block in text_blocks if not self._is_watermark_candidate(block, text_blocks)]

    def _filter_watermark_ocr_blocks(self, ocr_blocks: list[OcrBlock]) -> list[OcrBlock]:
        return [block for block in ocr_blocks if not self._is_watermark_candidate(block, ocr_blocks)]

    def _is_watermark_candidate(self, block: TextBlock | OcrBlock, siblings: list[TextBlock] | list[OcrBlock]) -> bool:
        text = " ".join(block.text.split())
        normalized = self._normalize_watermark_text(text)
        if len(normalized) < 4 or len(normalized) > 48:
            return False
        if ":" in text or len(text.split()) > 6:
            return False

        letters = [char for char in text if char.isalpha()]
        uppercase_ratio = (
            sum(1 for char in letters if char.isupper()) / len(letters)
            if letters
            else 0.0
        )
        if uppercase_ratio < 0.6:
            return False

        x0, y0, x1, y1 = self._block_bounds(block)
        page_width, page_height = self._page_extent(block.page, siblings)
        if page_width <= 0 or page_height <= 0:
            return False

        width_ratio = max(x1 - x0, 0.0) / page_width
        center_x_ratio = ((x0 + x1) / 2) / page_width
        center_y_ratio = ((y0 + y1) / 2) / page_height
        repeated_pages = {
            sibling.page
            for sibling in siblings
            if self._normalize_watermark_text(sibling.text) == normalized
        }
        repeated = len(repeated_pages) >= 2

        centered = 0.2 <= center_x_ratio <= 0.8 and 0.2 <= center_y_ratio <= 0.8
        if isinstance(block, OcrBlock):
            angle = self._ocr_block_angle_deg(block)
            diagonal = 15.0 <= angle <= 75.0
            if diagonal and centered and width_ratio >= 0.2:
                return True

        return centered and width_ratio >= 0.35 and (repeated or width_ratio >= 0.55)

    def _normalize_watermark_text(self, text: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()

    def _block_bounds(self, block: TextBlock | OcrBlock) -> tuple[float, float, float, float]:
        if isinstance(block, TextBlock):
            return block.x0, block.y0, block.x1, block.y1
        xs = [point[0] for point in block.bounding_box]
        ys = [point[1] for point in block.bounding_box]
        return min(xs), min(ys), max(xs), max(ys)

    def _ocr_block_angle_deg(self, block: OcrBlock) -> float:
        if len(block.bounding_box) < 2:
            return 0.0
        p0 = block.bounding_box[0]
        p1 = block.bounding_box[1]
        dx = float(p1[0]) - float(p0[0])
        dy = float(p1[1]) - float(p0[1])
        if abs(dx) < 1e-6 and abs(dy) < 1e-6:
            return 0.0
        angle = abs(math.degrees(math.atan2(dy, dx)))
        if angle > 90.0:
            angle = 180.0 - angle
        return angle

    def _page_extent(self, page: int, blocks: list[TextBlock] | list[OcrBlock]) -> tuple[float, float]:
        page_blocks = [block for block in blocks if block.page == page]
        if not page_blocks:
            return 0.0, 0.0

        x_max = 0.0
        y_max = 0.0
        for block in page_blocks:
            _, _, x1, y1 = self._block_bounds(block)
            x_max = max(x_max, x1)
            y_max = max(y_max, y1)
        return max(x_max, 600.0), max(y_max, 800.0)
