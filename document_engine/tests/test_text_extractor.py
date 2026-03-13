from __future__ import annotations

from pathlib import Path

from document_engine.core.text_extractor import TextExtractor


def test_poppler_xml_blocks_are_added_to_native_extraction(monkeypatch, tmp_path: Path) -> None:
    extractor = TextExtractor()

    monkeypatch.setattr("document_engine.core.text_extractor.extract_pages", lambda *_args, **_kwargs: [])

    xml_path = tmp_path / "layout.xml"
    xml_path.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<pdf2xml>
  <page number="3" height="1262" width="892">
    <text top="466" left="294" width="39" height="18">Farges</text>
    <text top="520" left="294" width="40" height="18">Michel</text>
  </page>
</pdf2xml>
""",
        encoding="utf-8",
    )

    def fake_run(*_args, **_kwargs):
        generated = Path(_args[0][-1]).with_suffix(".xml")
        generated.write_text(xml_path.read_text(encoding="utf-8"), encoding="utf-8")
        return None

    monkeypatch.setattr("document_engine.core.text_extractor.subprocess.run", fake_run)

    full_text, blocks, page_count = extractor.extract(b"%PDF-1.4")

    assert page_count == 3
    assert "Farges" in full_text
    assert "Michel" in full_text
    assert any(block.text == "Farges" and block.page == 3 for block in blocks)
    assert any(block.text == "Michel" and block.page == 3 for block in blocks)
