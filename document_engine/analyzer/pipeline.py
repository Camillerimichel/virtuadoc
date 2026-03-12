from __future__ import annotations

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
from document_engine.core.pdf_loader import PdfLoader
from document_engine.core.text_extractor import TextExtractor
from document_engine.model_types import LayoutZone, OcrBlock


class AnalyzePipeline:
    def __init__(self, config_dir: Path) -> None:
        self.item_loader = ItemLoader(config_dir)
        self.pdf_loader = PdfLoader()
        self.text_extractor = TextExtractor()
        self.layout_parser = LayoutParser()
        self.structure_detector = StructureDetector()
        self.variant_matcher = VariantMatcher()
        self.scoring_engine = ScoringEngine()

    def run(self, item_name: str, base64_pdf: str, ocr_mode: str = "auto") -> dict:
        t0 = time.perf_counter()
        item_config = self.item_loader.load_item(item_name)
        global_rules = self.item_loader.load_global_rules()
        detector = ElementDetector(global_rules)

        document_id = str(uuid.uuid4())
        pdf_bytes = self.pdf_loader.decode_base64_pdf(base64_pdf)
        tmp_path = self.pdf_loader.persist_temp(pdf_bytes, Path("/tmp/document_engine"), f"{document_id}.pdf")

        full_text, text_blocks, page_count = self.text_extractor.extract(pdf_bytes)
        native_text_length = len(full_text)
        ocr_used = False
        ocr_blocks = []
        requested_mode = ocr_mode if ocr_mode in {"auto", "native", "ocr"} else "auto"
        applied_mode = "native" if requested_mode == "native" else "ocr"
        ocr_attempted = False
        ocr_error: str | None = None

        should_try_ocr = requested_mode == "ocr" or (requested_mode == "auto" and len(full_text) < 200)
        if should_try_ocr:
            ocr_attempted = True
            try:
                ocr_engine = OcrEngine(language=item_config.get("language", "fr"))
                ocr_blocks = ocr_engine.run(tmp_path)
                full_text = full_text + "\n" + "\n".join(b.text for b in ocr_blocks)
                ocr_used = len(ocr_blocks) > 0
                if requested_mode == "auto":
                    applied_mode = "ocr"
            except Exception as exc:
                ocr_used = False
                ocr_error = str(exc)
                if requested_mode == "auto":
                    applied_mode = "native"

        zones = self.layout_parser.build_zones(text_blocks)
        if ocr_blocks:
            zones.extend(self._zones_from_ocr_blocks(ocr_blocks))
        signature = self.structure_detector.compute_signature(page_count, full_text, zones)

        variants = item_config.get("variant_signatures", [])
        variant_name, variant_score, variant_match = self.variant_matcher.match(signature, variants)

        required_elements = item_config.get("required_elements", [])
        detections = detector.detect(required_elements, zones, [b.text for b in ocr_blocks])

        completeness_score = self.scoring_engine.compute(required_elements, detections)
        threshold = float(item_config.get("threshold", 0.7))
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

        return {
            "document_id": document_id,
            "item": item_name,
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
            "signature": {
                "page_count": signature.page_count,
                "dominant_keywords": signature.dominant_keywords,
                "layout_zones": signature.layout_zones,
                "table_presence": signature.table_presence,
                "title_patterns": signature.title_patterns,
            },
        }

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
