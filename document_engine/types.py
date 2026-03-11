from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class TextBlock:
    text: str
    page: int
    x0: float
    y0: float
    x1: float
    y1: float


@dataclass(slots=True)
class OcrBlock:
    text: str
    page: int
    confidence: float
    bounding_box: list[list[float]]


@dataclass(slots=True)
class LayoutZone:
    page: int
    zone_type: str
    x0: float
    y0: float
    x1: float
    y1: float
    text: str


@dataclass(slots=True)
class DocumentSignature:
    page_count: int
    dominant_keywords: list[str]
    layout_zones: dict[str, int]
    table_presence: bool
    title_patterns: list[str]


@dataclass(slots=True)
class DetectionResult:
    name: str
    page: int
    evidence: str
    confidence: float = 1.0
    meta: dict[str, Any] = field(default_factory=dict)
