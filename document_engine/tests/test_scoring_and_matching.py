from document_engine.analyzer.scoring_engine import ScoringEngine
from document_engine.analyzer.variant_matcher import VariantMatcher
from document_engine.types import DetectionResult, DocumentSignature


def test_scoring_engine_weighted_ratio() -> None:
    required = [
        {"name": "souscripteur", "weight": 2},
        {"name": "beneficiaire", "weight": 2},
        {"name": "date", "weight": 1},
        {"name": "signature", "weight": 3},
    ]
    detections = [
        DetectionResult(name="souscripteur", page=1, evidence="text"),
        DetectionResult(name="signature", page=6, evidence="text"),
    ]
    assert ScoringEngine().compute(required, detections) == 0.625


def test_variant_matcher_picks_best_variant() -> None:
    signature = DocumentSignature(
        page_count=6,
        dominant_keywords=["axa", "assurance", "vie", "souscripteur"],
        layout_zones={"title": 4, "paragraph": 20, "table": 2},
        table_presence=True,
        title_patterns=["Contrat d'assurance vie", "Conditions particulières"],
    )

    variants = [
        {
            "name": "axa_v1",
            "page_count": 6,
            "dominant_keywords": ["axa", "assurance", "vie"],
            "table_presence": True,
            "title_patterns": ["Contrat d'assurance vie"],
        },
        {
            "name": "other_v1",
            "page_count": 8,
            "dominant_keywords": ["banque", "releve"],
            "table_presence": False,
            "title_patterns": ["Relevé bancaire"],
        },
    ]

    name, score, matched = VariantMatcher().match(signature, variants)
    assert name == "axa_v1"
    assert matched is True
    assert score >= 0.6
