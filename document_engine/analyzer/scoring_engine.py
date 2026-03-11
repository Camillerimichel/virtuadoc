from __future__ import annotations

from document_engine.types import DetectionResult


class ScoringEngine:
    def compute(self, required_elements: list[dict], detections: list[DetectionResult]) -> float:
        if not required_elements:
            return 0.0

        detected_names = {d.name for d in detections}
        total = sum(float(e.get("weight", 1)) for e in required_elements)
        matched = sum(float(e.get("weight", 1)) for e in required_elements if e["name"] in detected_names)

        if total <= 0:
            return 0.0
        return round(matched / total, 4)
