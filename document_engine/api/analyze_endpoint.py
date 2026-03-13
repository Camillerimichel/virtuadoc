from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException

from document_engine.analyzer.pipeline import AnalyzePipeline
from document_engine.api.schemas import (
    AnalyzeBatchRequest,
    AnalyzeBatchResponse,
    AnalyzeBatchResult,
    AnalyzeRequest,
    AnalyzeResponse,
)

router = APIRouter()
pipeline = AnalyzePipeline(config_dir=Path(__file__).resolve().parents[1] / "config")


def _build_analyze_response(result: dict) -> AnalyzeResponse:
    return AnalyzeResponse(
        document_id=result["document_id"],
        item=result["item"],
        item_auto_detected=result.get("item_auto_detected", False),
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
        document_type=result["document_type"],
        excel_pairs_preview=result.get("excel_pairs_preview", []),
    )


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze(payload: AnalyzeRequest) -> AnalyzeResponse:
    if len(payload.documents) != 1:
        raise HTTPException(status_code=400, detail="Exactly one document is supported per request")

    try:
        result = pipeline.run(
            payload.item,
            payload.documents[0],
            payload.ocr_mode,
            payload.document_type,
            payload.excel_header_axis,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _build_analyze_response(result)


@router.post("/analyze-batch", response_model=AnalyzeBatchResponse)
def analyze_batch(payload: AnalyzeBatchRequest) -> AnalyzeBatchResponse:
    if len(payload.documents) != len(payload.document_types):
        raise HTTPException(status_code=400, detail="'documents' and 'document_types' must have the same length")
    if payload.filenames and len(payload.filenames) != len(payload.documents):
        raise HTTPException(status_code=400, detail="'filenames' and 'documents' must have the same length")
    if not payload.detect_item and not payload.item:
        raise HTTPException(status_code=400, detail="Manual analysis requires an item name")

    results: list[AnalyzeBatchResult] = []
    success_count = 0

    for idx, base64_document in enumerate(payload.documents):
        filename = payload.filenames[idx] if idx < len(payload.filenames) else None
        document_type = payload.document_types[idx]
        try:
            if payload.detect_item:
                raw_result = pipeline.run_with_item_detection(
                    base64_document=base64_document,
                    ocr_mode=payload.ocr_mode,
                    document_type=document_type,
                    excel_header_axis=payload.excel_header_axis,
                )
            else:
                raw_result = pipeline.run(
                    item_name=str(payload.item),
                    base64_document=base64_document,
                    ocr_mode=payload.ocr_mode,
                    document_type=document_type,
                    excel_header_axis=payload.excel_header_axis,
                )
            results.append(
                AnalyzeBatchResult(
                    filename=filename,
                    document_type=document_type,
                    item_requested=None if payload.detect_item else payload.item,
                    success=True,
                    analysis=_build_analyze_response(raw_result),
                )
            )
            success_count += 1
        except (FileNotFoundError, ValueError) as exc:
            results.append(
                AnalyzeBatchResult(
                    filename=filename,
                    document_type=document_type,
                    item_requested=None if payload.detect_item else payload.item,
                    success=False,
                    error=str(exc),
                )
            )

    return AnalyzeBatchResponse(
        results=results,
        total_count=len(results),
        success_count=success_count,
        error_count=len(results) - success_count,
    )
