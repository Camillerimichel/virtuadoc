from __future__ import annotations

import subprocess
import tempfile
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path
from typing import Iterator

from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer, LTTextLine

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
                line_added = False
                for line in self._iter_lines(element):
                    text = " ".join(line.get_text().split())
                    if not text:
                        continue
                    x0, y0, x1, y1 = line.bbox
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
                    line_added = True

                # Fallback: if no line object was extracted, keep container-level text.
                if not line_added:
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

        poppler_blocks, poppler_page_count = self._extract_with_poppler(pdf_bytes)
        if poppler_blocks:
            existing_keys = {
                (block.page, round(block.x0, 1), round(block.y0, 1), round(block.x1, 1), round(block.y1, 1), block.text)
                for block in blocks
            }
            for block in poppler_blocks:
                key = (block.page, round(block.x0, 1), round(block.y0, 1), round(block.x1, 1), round(block.y1, 1), block.text)
                if key in existing_keys:
                    continue
                existing_keys.add(key)
                blocks.append(block)
                text_parts.append(block.text)
            page_count = max(page_count, poppler_page_count)

        full_text = "\n".join(text_parts)
        return full_text, blocks, page_count

    def _iter_lines(self, node: object) -> Iterator[LTTextLine]:
        if isinstance(node, LTTextLine):
            yield node
            return

        children = getattr(node, "_objs", None)
        if not children:
            return
        for child in children:
            yield from self._iter_lines(child)

    def _extract_with_poppler(self, pdf_bytes: bytes) -> tuple[list[TextBlock], int]:
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)
                pdf_path = temp_path / "document.pdf"
                xml_base = temp_path / "layout"
                pdf_path.write_bytes(pdf_bytes)
                subprocess.run(
                    ["pdftohtml", "-xml", str(pdf_path), str(xml_base)],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                xml_path = xml_base.with_suffix(".xml")
                if not xml_path.exists():
                    return [], 0
                return self._parse_poppler_xml(xml_path)
        except (FileNotFoundError, subprocess.CalledProcessError, ET.ParseError):
            return [], 0

    def _parse_poppler_xml(self, xml_path: Path) -> tuple[list[TextBlock], int]:
        root = ET.fromstring(xml_path.read_text(encoding="utf-8"))
        blocks: list[TextBlock] = []
        page_count = 0
        for page in root.findall("page"):
            try:
                page_idx = int(page.attrib.get("number", "0"))
                page_height = float(page.attrib.get("height", "0"))
            except ValueError:
                continue
            page_count = max(page_count, page_idx)
            for node in page.findall("text"):
                text = " ".join("".join(node.itertext()).split())
                if not text:
                    continue
                try:
                    left = float(node.attrib.get("left", "0"))
                    top = float(node.attrib.get("top", "0"))
                    width = float(node.attrib.get("width", "0"))
                    height = float(node.attrib.get("height", "0"))
                except ValueError:
                    continue
                x0 = left
                x1 = left + width
                y1 = page_height - top
                y0 = y1 - height
                blocks.append(
                    TextBlock(
                        text=text,
                        page=page_idx,
                        x0=x0,
                        y0=y0,
                        x1=x1,
                        y1=y1,
                    )
                )
        return blocks, page_count
