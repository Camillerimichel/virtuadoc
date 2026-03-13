from document_engine.analyzer.element_detector import ElementDetector
from document_engine.model_types import LayoutZone


def test_ignores_tall_ocr_block_when_picking_right_value() -> None:
    zones = [
        LayoutZone(page=1, zone_type="paragraph", x0=86, y0=555, x1=137, y1=582, text="Sigle"),
        LayoutZone(page=1, zone_type="paragraph", x0=387, y0=553, x1=438, y1=580, text="OEA"),
        LayoutZone(page=1, zone_type="paragraph", x0=86, y0=582, x1=227, y1=607, text="Forme juridique"),
        LayoutZone(
            page=1,
            zone_type="paragraph",
            x0=384,
            y0=571,
            x1=846,
            y1=612,
            text="Société par actions simplifiée",
        ),
        LayoutZone(page=1, zone_type="paragraph", x0=81, y0=602, x1=214, y1=640, text="Capital social"),
        LayoutZone(page=1, zone_type="paragraph", x0=389, y0=607, x1=519, y1=632, text="1 000,00 Euros"),
        LayoutZone(page=1, zone_type="paragraph", x0=253, y0=560, x1=427, y1=747, text="TRIBL"),
    ]

    detections = ElementDetector(global_rules={}).detect(
        required_elements=[
            {"name": "sigle", "weight": 1},
            {"name": "forme juridique", "weight": 1},
            {"name": "capital", "weight": 1},
        ],
        zones=zones,
        ocr_texts=[],
    )

    values = {d.name: d.meta.get("field_value") for d in detections}

    assert values["sigle"] == "OEA"
    assert values["forme juridique"] == "Société par actions simplifiée"
    assert values["capital"] == "1 000,00 Euros"
