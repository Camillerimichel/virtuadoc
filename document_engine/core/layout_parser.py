from __future__ import annotations

from document_engine.model_types import LayoutZone, TextBlock


class LayoutParser:
    def build_zones(self, text_blocks: list[TextBlock]) -> list[LayoutZone]:
        zones: list[LayoutZone] = []

        for block in text_blocks:
            zone_type = self._infer_zone_type(block.text)
            zones.append(
                LayoutZone(
                    page=block.page,
                    zone_type=zone_type,
                    x0=block.x0,
                    y0=block.y0,
                    x1=block.x1,
                    y1=block.y1,
                    text=block.text,
                )
            )

        return zones

    def _infer_zone_type(self, text: str) -> str:
        normalized = text.strip()
        if not normalized:
            return "empty"
        if len(normalized) < 80 and (normalized.isupper() or normalized.endswith(":")):
            return "label"
        if "|" in normalized or normalized.count(";") >= 2:
            return "table"
        if normalized.count("_") >= 6 or "cocher" in normalized.lower() or "[]" in normalized:
            return "form_zone"
        if len(normalized) < 120 and normalized[:1].isdigit() and "." in normalized[:5]:
            return "title"
        return "paragraph"
