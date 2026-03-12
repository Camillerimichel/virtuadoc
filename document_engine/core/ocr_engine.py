from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from document_engine.model_types import OcrBlock


class OcrEngine:
    def __init__(self, language: str = "fr") -> None:
        self.language = language
        self._ocr = None

    def _lazy_init(self) -> None:
        if self._ocr is not None:
            return
        from paddleocr import PaddleOCR  # lazy import to keep startup lightweight
        os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

        # PaddleOCR args vary between major versions; keep a backward-compatible init.
        for kwargs in (
            {
                "lang": self.language,
                "text_detection_model_name": "PP-OCRv5_mobile_det",
                "text_recognition_model_name": "latin_PP-OCRv5_mobile_rec",
                "use_doc_orientation_classify": False,
                "use_doc_unwarping": False,
                "use_textline_orientation": False,
                "enable_mkldnn": False,
            },
            {"lang": self.language, "enable_mkldnn": False},
            {"use_angle_cls": True, "lang": self.language, "show_log": False},
            {"use_angle_cls": True, "lang": self.language},
        ):
            try:
                self._ocr = PaddleOCR(**kwargs)
                return
            except Exception:
                continue
        raise RuntimeError("Impossible d'initialiser PaddleOCR avec les paramètres supportés")

    def run(self, pdf_path: Path) -> list[OcrBlock]:
        self._lazy_init()
        raw_result: Any
        try:
            raw_result = self._ocr.predict(
                str(pdf_path),
                text_det_limit_side_len=736,
                text_det_limit_type="max",
            )
        except TypeError:
            try:
                raw_result = self._ocr.ocr(str(pdf_path))
            except TypeError:
                raw_result = self._ocr.ocr(str(pdf_path), cls=True)
        blocks: list[OcrBlock] = []

        for page_idx, page in enumerate(raw_result or [], start=1):
            if page is None:
                continue
            if isinstance(page, dict) and "rec_texts" in page and "dt_polys" in page:
                blocks.extend(self._parse_predict_page(page, page_idx))
                continue
            blocks.extend(self._parse_legacy_page(page, page_idx))
        return blocks

    def _parse_predict_page(self, page: dict[str, Any], default_page: int) -> list[OcrBlock]:
        rec_texts = page.get("rec_texts") or []
        rec_scores = page.get("rec_scores") or []
        dt_polys = page.get("dt_polys") or []
        page_idx = int(page.get("page_index", default_page - 1)) + 1
        items = min(len(rec_texts), len(dt_polys))
        parsed: list[OcrBlock] = []
        for idx in range(items):
            text = str(rec_texts[idx]).strip()
            if not text:
                continue
            raw_bbox = dt_polys[idx]
            if raw_bbox is None:
                continue
            bbox = [[float(p[0]), float(p[1])] for p in raw_bbox]
            score = float(rec_scores[idx]) if idx < len(rec_scores) else 0.0
            parsed.append(OcrBlock(text=text, page=page_idx, confidence=score, bounding_box=bbox))
        return parsed

    def _parse_legacy_page(self, page: Any, page_idx: int) -> list[OcrBlock]:
        parsed: list[OcrBlock] = []
        for line in page:
            bbox = [[float(p[0]), float(p[1])] for p in line[0]]
            text = str(line[1][0]).strip()
            conf = float(line[1][1])
            if not text:
                continue
            parsed.append(OcrBlock(text=text, page=page_idx, confidence=conf, bounding_box=bbox))
        return parsed
