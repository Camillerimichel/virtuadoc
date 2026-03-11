from __future__ import annotations

import re
from collections import Counter

from document_engine.model_types import DocumentSignature, LayoutZone

_STOP_WORDS = {
    "de",
    "la",
    "le",
    "les",
    "du",
    "des",
    "et",
    "ou",
    "en",
    "un",
    "une",
    "au",
    "aux",
    "pour",
    "avec",
    "sur",
}


class StructureDetector:
    def compute_signature(
        self,
        page_count: int,
        full_text: str,
        zones: list[LayoutZone],
    ) -> DocumentSignature:
        keywords = self._dominant_keywords(full_text)
        layout_counter = Counter(zone.zone_type for zone in zones)
        table_presence = layout_counter.get("table", 0) > 0 or self._has_table_hints(full_text)
        title_patterns = self._title_patterns(zones)

        return DocumentSignature(
            page_count=page_count,
            dominant_keywords=keywords,
            layout_zones=dict(layout_counter),
            table_presence=table_presence,
            title_patterns=title_patterns,
        )

    def _dominant_keywords(self, text: str, limit: int = 20) -> list[str]:
        tokens = re.findall(r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-]{2,}", text.lower())
        filtered = [token for token in tokens if token not in _STOP_WORDS]
        return [word for word, _ in Counter(filtered).most_common(limit)]

    def _has_table_hints(self, text: str) -> bool:
        return "tableau" in text.lower() or text.count("|") > 5

    def _title_patterns(self, zones: list[LayoutZone]) -> list[str]:
        titles = [z.text.strip() for z in zones if z.zone_type in {"title", "label"}]
        return titles[:10]
