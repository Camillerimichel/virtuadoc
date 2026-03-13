from __future__ import annotations

import base64
from pathlib import Path

from document_engine.analyzer.pipeline import AnalyzePipeline
from document_engine.model_types import OcrBlock, TextBlock


def test_auto_mode_retries_with_ocr_when_native_detection_is_weak(
    monkeypatch,
    tmp_path: Path,
) -> None:
    config_dir = tmp_path / "config"
    (config_dir / "items").mkdir(parents=True)
    (config_dir / "global").mkdir(parents=True)
    (config_dir / "items" / "sample.yml").write_text(
        "\n".join(
            [
                "threshold: 0.7",
                "required_elements:",
                "  - name: date",
                "    weight: 1",
            ]
        ),
        encoding="utf-8",
    )
    (config_dir / "global" / "rules.yml").write_text(
        "\n".join(
            [
                "aliases: {}",
                "regex:",
                "  date:",
                "    - \"\\\\b(0?[1-9]|[12][0-9]|3[01])[\\\\/\\\\-.](0?[1-9]|1[0-2])[\\\\/\\\\-.](19|20)\\\\d{2}\\\\b\"",
            ]
        ),
        encoding="utf-8",
    )

    pipeline = AnalyzePipeline(config_dir=config_dir)
    encoded = base64.b64encode(b"fake pdf bytes").decode("ascii")

    monkeypatch.setattr(pipeline.pdf_loader, "decode_base64_pdf", lambda _: b"%PDF")
    monkeypatch.setattr(
        pipeline.pdf_loader,
        "persist_temp",
        lambda *_args, **_kwargs: tmp_path / "doc.pdf",
    )
    monkeypatch.setattr(
        pipeline.text_extractor,
        "extract",
        lambda _pdf_bytes: (
            "contenu " * 40,
            [TextBlock(text="Texte sans date exploitable", page=1, x0=10, y0=10, x1=120, y1=20)],
            1,
        ),
    )
    monkeypatch.setattr(
        "document_engine.analyzer.pipeline.OcrEngine.run",
        lambda self, _pdf_path: [
            OcrBlock(
                text="Date : 01/02/2026",
                page=1,
                confidence=0.99,
                bounding_box=[[0.0, 0.0], [100.0, 0.0], [100.0, 20.0], [0.0, 20.0]],
            )
        ],
    )

    result = pipeline.run(item_name="sample", base64_document=encoded, ocr_mode="auto")

    assert result["ocr_attempted"] is True
    assert result["ocr_used"] is True
    assert result["ocr_mode_applied"] == "ocr"
    assert result["missing_elements"] == []
    assert result["elements_found"][0]["name"] == "date"
    assert result["elements_found"][0]["value"] == "01/02/2026"


def test_auto_mode_ignores_repeated_centered_watermark_before_deciding_on_ocr(
    monkeypatch,
    tmp_path: Path,
) -> None:
    config_dir = tmp_path / "config"
    (config_dir / "items").mkdir(parents=True)
    (config_dir / "global").mkdir(parents=True)
    (config_dir / "items" / "sample.yml").write_text(
        "threshold: 0.7\nrequired_elements:\n  - name: date\n    weight: 1\n",
        encoding="utf-8",
    )
    (config_dir / "global" / "rules.yml").write_text(
        'aliases: {}\nregex:\n  date:\n    - "\\\\b(0?[1-9]|[12][0-9]|3[01])[\\\\/\\\\-.](0?[1-9]|1[0-2])[\\\\/\\\\-.](19|20)\\\\d{2}\\\\b"\n',
        encoding="utf-8",
    )

    pipeline = AnalyzePipeline(config_dir=config_dir)
    encoded = base64.b64encode(b"fake pdf bytes").decode("ascii")

    monkeypatch.setattr(pipeline.pdf_loader, "decode_base64_pdf", lambda _: b"%PDF")
    monkeypatch.setattr(
        pipeline.pdf_loader,
        "persist_temp",
        lambda *_args, **_kwargs: tmp_path / "doc.pdf",
    )
    monkeypatch.setattr(
        pipeline.text_extractor,
        "extract",
        lambda _pdf_bytes: (
            "\n".join(["CONFIDENTIEL"] * 40),
            [
                TextBlock(text="CONFIDENTIEL", page=1, x0=80, y0=350, x1=520, y1=430),
                TextBlock(text="CONFIDENTIEL", page=2, x0=82, y0=352, x1=518, y1=432),
            ],
            2,
        ),
    )
    monkeypatch.setattr(
        "document_engine.analyzer.pipeline.OcrEngine.run",
        lambda self, _pdf_path: [
            OcrBlock(
                text="Date : 01/02/2026",
                page=1,
                confidence=0.99,
                bounding_box=[[0.0, 0.0], [100.0, 0.0], [100.0, 20.0], [0.0, 20.0]],
            )
        ],
    )

    result = pipeline.run(item_name="sample", base64_document=encoded, ocr_mode="auto")

    assert result["native_text_length"] == 0
    assert result["ocr_attempted"] is True
    assert result["elements_found"][0]["value"] == "01/02/2026"


def test_filters_diagonal_ocr_watermark_without_dropping_horizontal_field() -> None:
    pipeline = AnalyzePipeline(config_dir=Path("/var/www/VirtuaDoc/document_engine/config"))
    diagonal_watermark = OcrBlock(
        text="COPIE",
        page=1,
        confidence=0.95,
        bounding_box=[[180.0, 300.0], [300.0, 420.0], [270.0, 450.0], [150.0, 330.0]],
    )
    horizontal_field = OcrBlock(
        text="Date : 01/02/2026",
        page=1,
        confidence=0.99,
        bounding_box=[[10.0, 10.0], [160.0, 10.0], [160.0, 30.0], [10.0, 30.0]],
    )

    filtered = pipeline._filter_watermark_ocr_blocks([diagonal_watermark, horizontal_field])

    assert [block.text for block in filtered] == ["Date : 01/02/2026"]
