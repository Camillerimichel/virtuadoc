from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    item: str = Field(min_length=1)
    documents: list[str] = Field(min_length=1)
    ocr_mode: Literal["auto", "native", "ocr"] = "auto"
    document_type: Literal["pdf", "excel"] = "pdf"
    excel_header_axis: Literal["first_row", "first_column"] = "first_row"


class ElementFound(BaseModel):
    name: str
    page: int
    evidence: str | None = None
    value: str | None = None
    value_position: str | None = None
    right_text: str | None = None
    below_text: str | None = None
    anchor_text: str | None = None
    target_text: str | None = None
    target_right_text: str | None = None
    target_below_text: str | None = None
    lines_below: str | None = None


class AnalyzeResponse(BaseModel):
    document_id: str
    item: str
    score: float
    valid: bool
    variant_detected: str | None
    variant_score: float
    threshold: float
    matched_weight_sum: float
    total_weight_sum: float
    missing_elements: list[str]
    elements_found: list[ElementFound]
    ocr_used: bool
    ocr_mode_requested: Literal["auto", "native", "ocr"] = "auto"
    ocr_mode_applied: Literal["native", "ocr"] = "native"
    ocr_attempted: bool = False
    ocr_blocks_count: int = 0
    native_text_length: int = 0
    ocr_error: str | None = None
    processing_time_ms: int
    document_type: Literal["pdf", "excel"] = "pdf"
    excel_pairs_preview: list[str] = []


class BuildItemRequest(BaseModel):
    item: str
    template: str = "contract"
    language: str = "fr"
    threshold: float = 0.7
    documents: list[str] = Field(min_length=3, max_length=10)
    document_type: Literal["pdf", "excel"] = "pdf"
    excel_header_axis: Literal["first_row", "first_column"] = "first_row"
