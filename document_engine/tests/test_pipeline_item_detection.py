from pathlib import Path

from document_engine.analyzer.pipeline import AnalyzePipeline


def test_candidate_key_prefers_valid_results() -> None:
    pipeline = AnalyzePipeline(config_dir=Path("/var/www/VirtuaDoc/document_engine/config"))

    valid_result = {
        "valid": True,
        "score": 0.4,
        "matched_weight_sum": 2.0,
        "total_weight_sum": 10.0,
        "variant_score": 0.2,
    }
    stronger_invalid = {
        "valid": False,
        "score": 0.9,
        "matched_weight_sum": 9.0,
        "total_weight_sum": 10.0,
        "variant_score": 0.9,
    }

    assert pipeline._candidate_key(valid_result) > pipeline._candidate_key(stronger_invalid)


def test_run_with_item_detection_picks_best_candidate(monkeypatch) -> None:
    pipeline = AnalyzePipeline(config_dir=Path("/var/www/VirtuaDoc/document_engine/config"))

    monkeypatch.setattr(pipeline.item_loader, "list_items", lambda: ["item_a", "item_b"])

    def fake_run(item_name: str, base64_document: str, ocr_mode: str, document_type: str, excel_header_axis: str) -> dict:
        return {
            "document_id": f"doc-{item_name}",
            "item": item_name,
            "score": 0.5 if item_name == "item_a" else 1.0,
            "valid": item_name == "item_b",
            "variant_detected": "v1",
            "variant_score": 0.4 if item_name == "item_a" else 0.8,
            "threshold": 0.7,
            "matched_weight_sum": 3.0 if item_name == "item_a" else 5.0,
            "total_weight_sum": 5.0,
            "missing_elements": [],
            "elements_found": [],
            "ocr_used": False,
            "ocr_mode_requested": ocr_mode,
            "ocr_mode_applied": "native",
            "ocr_attempted": False,
            "ocr_blocks_count": 0,
            "native_text_length": 100,
            "ocr_error": None,
            "processing_time_ms": 10,
            "document_type": document_type,
            "excel_pairs_preview": [],
        }

    monkeypatch.setattr(pipeline, "run", fake_run)

    result = pipeline.run_with_item_detection(
        base64_document="ZmFrZQ==",
        ocr_mode="auto",
        document_type="pdf",
        excel_header_axis="first_row",
    )

    assert result["item"] == "item_b"
    assert result["item_auto_detected"] is True
