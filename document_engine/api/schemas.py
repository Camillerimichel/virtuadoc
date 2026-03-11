from __future__ import annotations

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    item: str = Field(min_length=1)
    documents: list[str] = Field(min_length=1)


class ElementFound(BaseModel):
    name: str
    page: int


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
    processing_time_ms: int


class BuildItemRequest(BaseModel):
    item: str
    template: str = "contract"
    language: str = "fr"
    threshold: float = 0.7
    documents: list[str] = Field(min_length=3, max_length=10)
