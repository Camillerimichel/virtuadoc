from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException

from document_engine.analyzer.pipeline import AnalyzePipeline
from document_engine.api.schemas import AnalyzeRequest, AnalyzeResponse

router = APIRouter()
pipeline = AnalyzePipeline(config_dir=Path(__file__).resolve().parents[1] / "config")


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze(payload: AnalyzeRequest) -> AnalyzeResponse:
    if len(payload.documents) != 1:
        raise HTTPException(status_code=400, detail="Exactly one document is supported per request")

    try:
        result = pipeline.run(payload.item, payload.documents[0], payload.ocr_mode)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return AnalyzeResponse(
        document_id=result["document_id"],
        item=result["item"],
        score=result["score"],
        valid=result["valid"],
        variant_detected=result["variant_detected"],
        variant_score=result["variant_score"],
        threshold=result["threshold"],
        matched_weight_sum=result["matched_weight_sum"],
        total_weight_sum=result["total_weight_sum"],
        missing_elements=result["missing_elements"],
        elements_found=result["elements_found"],
        ocr_used=result["ocr_used"],
        ocr_mode_requested=result["ocr_mode_requested"],
        ocr_mode_applied=result["ocr_mode_applied"],
        ocr_attempted=result["ocr_attempted"],
        ocr_blocks_count=result["ocr_blocks_count"],
        native_text_length=result["native_text_length"],
        ocr_error=result["ocr_error"],
        processing_time_ms=result["processing_time_ms"],
    )
