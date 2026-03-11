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


class AnalyzePipeline:
    def __init__(self, config_dir: Path) -> None:
        self.item_loader = ItemLoader(config_dir)
        self.pdf_loader = PdfLoader()
        self.text_extractor = TextExtractor()
        self.layout_parser = LayoutParser()
        self.structure_detector = StructureDetector()
        self.variant_matcher = VariantMatcher()
        self.scoring_engine = ScoringEngine()

    def run(self, item_name: str, base64_pdf: str) -> dict:
        t0 = time.perf_counter()
        item_config = self.item_loader.load_item(item_name)
        global_rules = self.item_loader.load_global_rules()
        detector = ElementDetector(global_rules)

        document_id = str(uuid.uuid4())
        pdf_bytes = self.pdf_loader.decode_base64_pdf(base64_pdf)
        tmp_path = self.pdf_loader.persist_temp(pdf_bytes, Path("/tmp/document_engine"), f"{document_id}.pdf")

        full_text, text_blocks, page_count = self.text_extractor.extract(pdf_bytes)
        ocr_used = False
        ocr_blocks = []

        if len(full_text) < 200:
            try:
                ocr_engine = OcrEngine(language=item_config.get("language", "fr"))
                ocr_blocks = ocr_engine.run(tmp_path)
                full_text = full_text + "\n" + "\n".join(b.text for b in ocr_blocks)
                ocr_used = len(ocr_blocks) > 0
            except Exception:
                ocr_used = False

        zones = self.layout_parser.build_zones(text_blocks)
        signature = self.structure_detector.compute_signature(page_count, full_text, zones)

        variants = item_config.get("variant_signatures", [])
        variant_name, variant_score, variant_match = self.variant_matcher.match(signature, variants)

        required_elements = item_config.get("required_elements", [])
        detections = detector.detect(required_elements, zones, [b.text for b in ocr_blocks])

        completeness_score = self.scoring_engine.compute(required_elements, detections)
        threshold = float(item_config.get("threshold", 0.7))
        valid = variant_match and completeness_score >= threshold

        return {
            "document_id": document_id,
            "item": item_name,
            "score": completeness_score,
            "valid": valid,
            "variant_detected": variant_name,
            "variant_score": variant_score,
            "elements_found": [{"name": d.name, "page": d.page} for d in detections],
            "ocr_used": ocr_used,
            "processing_time_ms": int((time.perf_counter() - t0) * 1000),
            "signature": {
                "page_count": signature.page_count,
                "dominant_keywords": signature.dominant_keywords,
                "layout_zones": signature.layout_zones,
                "table_presence": signature.table_presence,
                "title_patterns": signature.title_patterns,
            },
        }
