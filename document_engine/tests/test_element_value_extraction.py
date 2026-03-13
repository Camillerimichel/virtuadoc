from document_engine.analyzer.element_detector import ElementDetector
from document_engine.model_types import LayoutZone


def test_extracts_value_on_right_of_label() -> None:
    zones = [
        LayoutZone(page=1, zone_type="label", x0=10, y0=700, x1=140, y1=720, text="Immatriculation"),
        LayoutZone(page=1, zone_type="paragraph", x0=170, y0=700, x1=360, y1=720, text="RCS Paris 123 456 789"),
    ]
    detections = ElementDetector(global_rules={}).detect(
        required_elements=[{"name": "immatriculation", "weight": 1}],
        zones=zones,
        ocr_texts=[],
    )

    assert len(detections) == 1
    assert detections[0].meta.get("field_value") == "RCS Paris 123 456 789"
    assert detections[0].meta.get("value_position") == "right"
    assert detections[0].meta.get("right_text") == "RCS Paris 123 456 789"


def test_extracts_inline_value_after_colon() -> None:
    zones = [
        LayoutZone(
            page=1,
            zone_type="label",
            x0=10,
            y0=700,
            x1=360,
            y1=720,
            text="Date de début : 01/02/2026",
        ),
    ]
    detections = ElementDetector(global_rules={}).detect(
        required_elements=[{"name": "date de début", "weight": 1}],
        zones=zones,
        ocr_texts=[],
    )

    assert len(detections) == 1
    assert detections[0].meta.get("field_value") == "01/02/2026"
    assert detections[0].meta.get("value_position") == "right"


def test_collects_text_below_label() -> None:
    zones = [
        LayoutZone(page=1, zone_type="label", x0=10, y0=720, x1=220, y1=740, text="Adresse"),
        LayoutZone(page=1, zone_type="paragraph", x0=12, y0=690, x1=340, y1=710, text="12 rue Victor Hugo"),
    ]
    detections = ElementDetector(global_rules={}).detect(
        required_elements=[{"name": "adresse", "weight": 1}],
        zones=zones,
        ocr_texts=[],
    )

    assert len(detections) == 1
    assert detections[0].meta.get("below_text") == "12 rue Victor Hugo"


def test_does_not_take_above_text_as_below() -> None:
    zones = [
        LayoutZone(page=1, zone_type="label", x0=10, y0=500, x1=220, y1=520, text="Adresse"),
        # Above the label in PDF coordinates (higher y)
        LayoutZone(page=1, zone_type="paragraph", x0=12, y0=560, x1=340, y1=580, text="Texte au-dessus"),
        # Real below candidate (lower y)
        LayoutZone(page=1, zone_type="paragraph", x0=12, y0=460, x1=340, y1=480, text="Texte en dessous"),
    ]
    detections = ElementDetector(global_rules={}).detect(
        required_elements=[{"name": "adresse", "weight": 1}],
        zones=zones,
        ocr_texts=[],
    )

    assert len(detections) == 1
    assert detections[0].meta.get("below_text") == "Texte en dessous"


def test_relative_anchor_strategy_with_lines_below() -> None:
    zones = [
        LayoutZone(page=1, zone_type="label", x0=10, y0=740, x1=200, y1=760, text="Identification"),
        LayoutZone(page=1, zone_type="paragraph", x0=10, y0=710, x1=300, y1=730, text="Raison sociale"),
        LayoutZone(page=1, zone_type="paragraph", x0=10, y0=680, x1=300, y1=700, text="OPALHE ESG ADVISORS"),
        LayoutZone(page=1, zone_type="paragraph", x0=10, y0=650, x1=300, y1=670, text="Immatriculation RCS"),
    ]
    detections = ElementDetector(global_rules={}).detect(
        required_elements=[
            {
                "name": "raison_sociale_relative",
                "weight": 1,
                "strategy": "relative_anchor",
                "anchor": {"keyword": "Raison sociale", "occurrence": 1},
                "move": {"lines_below": 1, "tolerance": 0},
                "target": {"keyword": "OPALHE", "mode": "contains"},
            }
        ],
        zones=zones,
        ocr_texts=[],
    )

    assert len(detections) == 1
    assert detections[0].evidence == "relative-anchor"
    assert detections[0].meta.get("target_text") == "OPALHE ESG ADVISORS"


def test_relative_anchor_ignores_other_column_lines() -> None:
    zones = [
        LayoutZone(page=1, zone_type="label", x0=20, y0=740, x1=260, y1=760, text="Gestion, direction"),
        LayoutZone(page=1, zone_type="paragraph", x0=20, y0=710, x1=300, y1=730, text="Nom"),
        # Another column at the same vertical level that should be ignored.
        LayoutZone(page=1, zone_type="paragraph", x0=360, y0=710, x1=560, y1=730, text="Bloc autre colonne"),
        LayoutZone(page=1, zone_type="paragraph", x0=20, y0=680, x1=320, y1=700, text="JEAN DUPONT"),
    ]
    detections = ElementDetector(global_rules={}).detect(
        required_elements=[
            {
                "name": "president_nom",
                "weight": 2,
                "strategy": "relative_anchor",
                "anchor": {"keyword": "Gestion, direction", "occurrence": 1},
                "move": {"lines_below": 2, "tolerance": 0},
                "target": {"keyword": "JEAN", "mode": "contains"},
            }
        ],
        zones=zones,
        ocr_texts=[],
    )

    assert len(detections) == 1
    assert detections[0].meta.get("target_text") == "JEAN DUPONT"


def test_relative_anchor_accepts_multiple_target_keywords() -> None:
    zones = [
        LayoutZone(page=1, zone_type="label", x0=20, y0=740, x1=260, y1=760, text="Gestion, direction"),
        LayoutZone(page=1, zone_type="paragraph", x0=20, y0=710, x1=300, y1=730, text="Direction"),
        LayoutZone(page=1, zone_type="paragraph", x0=20, y0=680, x1=320, y1=700, text="JEAN DUPONT"),
    ]
    detections = ElementDetector(global_rules={}).detect(
        required_elements=[
            {
                "name": "president_nom",
                "weight": 2,
                "strategy": "relative_anchor",
                "anchor": {"keyword": "Gestion, direction", "occurrence": 1},
                "move": {"lines_below": 1, "tolerance": 0},
                "target": {"keyword": "nom, direction", "mode": "contains"},
            }
        ],
        zones=zones,
        ocr_texts=[],
    )

    assert len(detections) == 1
    assert detections[0].meta.get("target_text") == "Direction"
    assert detections[0].meta.get("field_value") == "JEAN DUPONT"


def test_relative_anchor_supports_ocr_coordinates_growing_downward() -> None:
    zones = [
        LayoutZone(page=1, zone_type="paragraph", x0=90, y0=964, x1=178, y1=989, text="Président"),
        LayoutZone(page=1, zone_type="paragraph", x0=144, y0=992, x1=273, y1=1017, text="Nom, prénoms"),
        LayoutZone(page=1, zone_type="paragraph", x0=389, y0=987, x1=639, y1=1017, text="CAMILLERI Michel Rosario"),
    ]
    detections = ElementDetector(global_rules={}).detect(
        required_elements=[
            {
                "name": "president_nom",
                "weight": 1,
                "strategy": "relative_anchor",
                "anchor": {"keyword": "Président", "occurrence": 1},
                "move": {"lines_below": 1, "tolerance": 0},
                "target": {"keyword": "Nom", "mode": "contains"},
            }
        ],
        zones=zones,
        ocr_texts=[],
    )

    assert len(detections) == 1
    assert detections[0].meta.get("target_text") == "Nom, prénoms"
    assert detections[0].meta.get("field_value") == "CAMILLERI Michel Rosario"
