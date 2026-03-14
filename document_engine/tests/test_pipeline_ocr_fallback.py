from __future__ import annotations

import base64
from pathlib import Path

from document_engine.analyzer.pipeline import AnalyzePipeline
from document_engine.core.ocr_engine import OcrEngine
from document_engine.model_types import DetectionResult, OcrBlock, TextBlock


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


def test_ocr_regions_are_used_before_full_ocr(
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
                "ocr_regions:",
                "  - name: date_zone",
                "    pages: \"1\"",
                "    x_pct: 10",
                "    y_pct: 10",
                "    width_pct: 30",
                "    height_pct: 10",
                "    margin_pct: 2",
            ]
        ),
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
            "contenu " * 40,
            [TextBlock(text="Texte sans date exploitable", page=1, x0=10, y0=10, x1=120, y1=20)],
            1,
        ),
    )
    monkeypatch.setattr(
        "document_engine.analyzer.pipeline.OcrEngine.run_regions",
        lambda self, _pdf_path, _regions: [
            OcrBlock(
                text="Date : 01/02/2026",
                page=1,
                confidence=0.99,
                bounding_box=[[0.0, 0.0], [100.0, 0.0], [100.0, 20.0], [0.0, 20.0]],
            )
        ],
    )

    def fail_full_ocr(self, _pdf_path):
        raise AssertionError("full OCR should not be called when OCR regions returned blocks")

    monkeypatch.setattr("document_engine.analyzer.pipeline.OcrEngine.run", fail_full_ocr)

    result = pipeline.run(item_name="sample", base64_document=encoded, ocr_mode="ocr")

    assert result["ocr_used"] is True
    assert result["elements_found"][0]["value"] == "01/02/2026"


def test_ocr_regions_fall_back_to_full_ocr_when_empty(
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
                "ocr_regions:",
                "  - name: date_zone",
                "    pages: \"1\"",
                "    x_pct: 10",
                "    y_pct: 10",
                "    width_pct: 30",
                "    height_pct: 10",
            ]
        ),
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
            "contenu " * 40,
            [TextBlock(text="Texte sans date exploitable", page=1, x0=10, y0=10, x1=120, y1=20)],
            1,
        ),
    )
    monkeypatch.setattr("document_engine.analyzer.pipeline.OcrEngine.run_regions", lambda self, _pdf_path, _regions: [])
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

    result = pipeline.run(item_name="sample", base64_document=encoded, ocr_mode="ocr")

    assert result["ocr_used"] is True
    assert result["elements_found"][0]["value"] == "01/02/2026"


def test_ocr_regions_can_drive_scoring_without_required_elements(
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
                "required_elements: []",
                "ocr_regions:",
                "  - name: Immatriculation",
                "    pages: \"1\"",
                "    x_pct: 10",
                "    y_pct: 10",
                "    width_pct: 30",
                "    height_pct: 10",
                "  - name: Dénomination",
                "    pages: \"1\"",
                "    x_pct: 10",
                "    y_pct: 20",
                "    width_pct: 30",
                "    height_pct: 10",
            ]
        ),
        encoding="utf-8",
    )
    (config_dir / "global" / "rules.yml").write_text("aliases: {}\nregex: {}\n", encoding="utf-8")

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
            "texte natif exploitable mais sans champs cibles",
            [TextBlock(text="Document", page=1, x0=10, y0=10, x1=120, y1=20)],
            1,
        ),
    )

    def fake_run_regions(self, _pdf_path, _regions):
        return [
            OcrBlock(
                text="123 456 789 RCS Paris",
                page=1,
                confidence=0.99,
                bounding_box=[[0.0, 0.0], [100.0, 0.0], [100.0, 20.0], [0.0, 20.0]],
                region_name="Immatriculation",
            ),
            OcrBlock(
                text="ACME Holding",
                page=1,
                confidence=0.98,
                bounding_box=[[0.0, 30.0], [100.0, 30.0], [100.0, 50.0], [0.0, 50.0]],
                region_name="Dénomination",
            ),
        ]

    monkeypatch.setattr("document_engine.analyzer.pipeline.OcrEngine.run_regions", fake_run_regions)
    monkeypatch.setattr(
        "document_engine.analyzer.pipeline.OcrEngine.run",
        lambda self, _pdf_path: [],
    )

    result = pipeline.run(item_name="sample", base64_document=encoded, ocr_mode="auto")

    assert result["ocr_attempted"] is True
    assert result["ocr_used"] is True
    assert result["score"] == 1.0
    assert result["missing_elements"] == []
    assert {element["name"] for element in result["elements_found"]} == {"Immatriculation", "Dénomination"}


def test_auto_mode_uses_ocr_when_only_ocr_regions_are_configured(
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
                "required_elements: []",
                "ocr_regions:",
                "  - name: Signature",
                "    pages: \"1\"",
                "    x_pct: 10",
                "    y_pct: 80",
                "    width_pct: 30",
                "    height_pct: 10",
            ]
        ),
        encoding="utf-8",
    )
    (config_dir / "global" / "rules.yml").write_text("aliases: {}\nregex: {}\n", encoding="utf-8")

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
            "contenu natif long " * 30,
            [TextBlock(text="Texte natif", page=1, x0=10, y0=10, x1=120, y1=20)],
            1,
        ),
    )
    monkeypatch.setattr(
        "document_engine.analyzer.pipeline.OcrEngine.run_regions",
        lambda self, _pdf_path, _regions: [
            OcrBlock(
                text="Signé électroniquement",
                page=1,
                confidence=0.96,
                bounding_box=[[0.0, 0.0], [100.0, 0.0], [100.0, 20.0], [0.0, 20.0]],
                region_name="Signature",
            )
        ],
    )

    result = pipeline.run(item_name="sample", base64_document=encoded, ocr_mode="auto")

    assert result["ocr_attempted"] is True
    assert result["score"] == 1.0
    assert result["missing_elements"] == []


def test_ocr_region_value_prefers_first_value_after_anchor(tmp_path: Path) -> None:
    config_dir = tmp_path / "config"
    (config_dir / "items").mkdir(parents=True)
    (config_dir / "global").mkdir(parents=True)
    (config_dir / "global" / "rules.yml").write_text("aliases: {}\nregex: {}\n", encoding="utf-8")
    pipeline = AnalyzePipeline(config_dir=config_dir)

    blocks = [
        OcrBlock(
            text="Immatriculation au RCS, numéro",
            page=1,
            confidence=0.98,
            bounding_box=[[0.0, 0.0], [100.0, 0.0], [100.0, 10.0], [0.0, 10.0]],
            region_name="Immatriculation",
        ),
        OcrBlock(
            text="921 026 415 R.C.S. Libourne",
            page=1,
            confidence=0.99,
            bounding_box=[[0.0, 12.0], [100.0, 12.0], [100.0, 22.0], [0.0, 22.0]],
            region_name="Immatriculation",
        ),
        OcrBlock(
            text="Date d'immatriculation",
            page=1,
            confidence=0.97,
            bounding_box=[[0.0, 24.0], [100.0, 24.0], [100.0, 34.0], [0.0, 34.0]],
            region_name="Immatriculation",
        ),
    ]

    value = pipeline._extract_ocr_region_value(blocks, "Immatriculation")

    assert value == "921 026 415 R.C.S. Libourne"


def test_ocr_region_value_prefers_name_line_after_anchor(tmp_path: Path) -> None:
    config_dir = tmp_path / "config"
    (config_dir / "items").mkdir(parents=True)
    (config_dir / "global").mkdir(parents=True)
    (config_dir / "global" / "rules.yml").write_text("aliases: {}\nregex: {}\n", encoding="utf-8")
    pipeline = AnalyzePipeline(config_dir=config_dir)

    blocks = [
        OcrBlock(
            text="Nom, prénoms",
            page=1,
            confidence=0.97,
            bounding_box=[[0.0, 0.0], [100.0, 0.0], [100.0, 10.0], [0.0, 10.0]],
            region_name="président",
        ),
        OcrBlock(
            text="CAMILLERI Michel Rosario",
            page=1,
            confidence=0.99,
            bounding_box=[[0.0, 12.0], [100.0, 12.0], [100.0, 22.0], [0.0, 22.0]],
            region_name="président",
        ),
        OcrBlock(
            text="Date et lieu de naissance",
            page=1,
            confidence=0.96,
            bounding_box=[[0.0, 24.0], [100.0, 24.0], [100.0, 34.0], [0.0, 34.0]],
            region_name="président",
        ),
    ]

    value = pipeline._extract_ocr_region_value(blocks, "Nom, prénoms")

    assert value == "CAMILLERI Michel Rosario"


def test_variant_can_be_optional_for_validity(
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
                "variant_required: false",
                "required_elements: []",
                "ocr_regions:",
                "  - name: Signature",
                "    pages: \"1\"",
                "    x_pct: 10",
                "    y_pct: 80",
                "    width_pct: 30",
                "    height_pct: 10",
                "variant_signatures:",
                "  - name: expected_variant",
                "    page_count: 2",
                "    dominant_keywords: [\"absent\"]",
                "    table_presence: false",
                "    title_patterns: [\"absent\"]",
            ]
        ),
        encoding="utf-8",
    )
    (config_dir / "global" / "rules.yml").write_text("aliases: {}\nregex: {}\n", encoding="utf-8")

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
            "contenu natif long " * 30,
            [TextBlock(text="Texte natif", page=1, x0=10, y0=10, x1=120, y1=20)],
            1,
        ),
    )
    monkeypatch.setattr(
        "document_engine.analyzer.pipeline.OcrEngine.run_regions",
        lambda self, _pdf_path, _regions: [
            OcrBlock(
                text="Signé électroniquement",
                page=1,
                confidence=0.96,
                bounding_box=[[0.0, 0.0], [100.0, 0.0], [100.0, 20.0], [0.0, 20.0]],
                region_name="Signature",
            )
        ],
    )

    result = pipeline.run(item_name="sample", base64_document=encoded, ocr_mode="auto")

    assert result["score"] == 1.0
    assert result["valid"] is True


def test_ocr_region_anchor_expands_search_area_when_initial_crop_misses_anchor(monkeypatch) -> None:
    engine = OcrEngine(language="fr")
    region = {
        "page": 1,
        "x_pct": 10.0,
        "y_pct": 10.0,
        "width_pct": 30.0,
        "height_pct": 10.0,
        "margin_pct": 2.0,
        "anchor_text": "signature",
        "anchor_mode": "contains",
        "anchor_search_radius_pct": 5.0,
    }

    monkeypatch.setattr(engine, "_crop_region", lambda _image, _region: ("initial", 0, 0))
    monkeypatch.setattr(
        engine,
        "_crop_region_with_extra_margin",
        lambda _image, _region, _extra: ("expanded", 10, 20),
    )

    initial_blocks = [
        OcrBlock(
            text="Date : 01/02/2026",
            page=1,
            confidence=0.99,
            bounding_box=[[0.0, 0.0], [100.0, 0.0], [100.0, 20.0], [0.0, 20.0]],
        )
    ]
    expanded_blocks = [
        OcrBlock(
            text="Signature du souscripteur",
            page=1,
            confidence=0.99,
            bounding_box=[[10.0, 20.0], [130.0, 20.0], [130.0, 40.0], [10.0, 40.0]],
        )
    ]

    def fake_predict(crop, _page, _offset_x, _offset_y):
        return initial_blocks if crop == "initial" else expanded_blocks

    monkeypatch.setattr(engine, "_predict_crop", fake_predict)

    result = engine._run_single_region(object(), region)

    assert [block.text for block in result] == ["Signature du souscripteur"]


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


def test_auto_mode_retries_with_ocr_when_native_values_look_like_labels() -> None:
    pipeline = AnalyzePipeline(config_dir=Path("/var/www/VirtuaDoc/document_engine/config"))
    required_elements = [
        {"name": "Nom", "weight": 1},
        {"name": "Prénom", "weight": 1},
        {"name": "Date de naissance", "weight": 1},
    ]
    detections = [
        DetectionResult(name="Nom", page=1, evidence="text-match", meta={"field_value": "Prénom"}),
        DetectionResult(name="Prénom", page=1, evidence="text-match", meta={"field_value": "Date de naissance"}),
        DetectionResult(name="Date de naissance", page=1, evidence="text-match", meta={"field_value": "_______"}),
    ]

    assert pipeline._should_retry_with_ocr(
        full_text="Texte natif suffisamment long " * 20,
        text_blocks=[object()] * 12,
        required_elements=required_elements,
        detections=detections,
        completeness_score=1.0,
        threshold=0.7,
    ) is True
