from __future__ import annotations

from io import BytesIO

from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer

from document_engine.model_types import TextBlock


class TextExtractor:
    def extract(self, pdf_bytes: bytes) -> tuple[str, list[TextBlock], int]:
        blocks: list[TextBlock] = []
        text_parts: list[str] = []
        page_count = 0

        for page_idx, page_layout in enumerate(extract_pages(BytesIO(pdf_bytes)), start=1):
            page_count = page_idx
            for element in page_layout:
                if not isinstance(element, LTTextContainer):
                    continue
                text = " ".join(element.get_text().split())
                if not text:
                    continue
                x0, y0, x1, y1 = element.bbox
                blocks.append(
                    TextBlock(
                        text=text,
                        page=page_idx,
                        x0=float(x0),
                        y0=float(y0),
                        x1=float(x1),
                        y1=float(y1),
                    )
                )
                text_parts.append(text)

        full_text = "\n".join(text_parts)
        return full_text, blocks, page_count
