from __future__ import annotations

from pathlib import Path

from document_engine.types import OcrBlock


class OcrEngine:
    def __init__(self, language: str = "fr") -> None:
        self.language = language
        self._ocr = None

    def _lazy_init(self) -> None:
        if self._ocr is not None:
            return
        from paddleocr import PaddleOCR  # lazy import to keep startup lightweight

        self._ocr = PaddleOCR(use_angle_cls=True, lang=self.language, show_log=False)

    def run(self, pdf_path: Path) -> list[OcrBlock]:
        self._lazy_init()
        raw_result = self._ocr.ocr(str(pdf_path), cls=True)
        blocks: list[OcrBlock] = []

        for page_idx, page in enumerate(raw_result or [], start=1):
            if not page:
                continue
            for line in page:
                bbox = [[float(p[0]), float(p[1])] for p in line[0]]
                text = str(line[1][0]).strip()
                conf = float(line[1][1])
                if not text:
                    continue
                blocks.append(
                    OcrBlock(
                        text=text,
                        page=page_idx,
                        confidence=conf,
                        bounding_box=bbox,
                    )
                )
        return blocks
