from __future__ import annotations

from rapidfuzz import fuzz

from document_engine.types import DocumentSignature


class VariantMatcher:
    def match(
        self,
        signature: DocumentSignature,
        variants: list[dict],
    ) -> tuple[str | None, float, bool]:
        if not variants:
            return None, 0.0, False

        best_name: str | None = None
        best_score = -1.0

        for variant in variants:
            score = self._score_variant(signature, variant)
            if score > best_score:
                best_score = score
                best_name = variant.get("name")

        matched = best_score >= 0.6
        return best_name, best_score, matched

    def _score_variant(self, signature: DocumentSignature, variant: dict) -> float:
        expected_pages = int(variant.get("page_count", 0))
        page_score = 1.0 if expected_pages == signature.page_count else max(0.0, 1 - abs(expected_pages - signature.page_count) / max(expected_pages, 1))

        expected_keywords = variant.get("dominant_keywords", [])
        keyword_score = self._keyword_score(signature.dominant_keywords, expected_keywords)

        expected_table = bool(variant.get("table_presence", False))
        table_score = 1.0 if expected_table == signature.table_presence else 0.0

        expected_titles = variant.get("title_patterns", [])
        title_score = self._title_score(signature.title_patterns, expected_titles)

        return round((0.35 * page_score) + (0.35 * keyword_score) + (0.15 * table_score) + (0.15 * title_score), 4)

    def _keyword_score(self, actual: list[str], expected: list[str]) -> float:
        if not expected:
            return 0.0
        actual_set = set(actual)
        overlap = sum(1 for word in expected if word.lower() in actual_set)
        return overlap / len(expected)

    def _title_score(self, actual: list[str], expected: list[str]) -> float:
        if not expected:
            return 0.0
        scores: list[float] = []
        for e in expected:
            best = max((fuzz.partial_ratio(e.lower(), a.lower()) for a in actual), default=0)
            scores.append(best / 100)
        return sum(scores) / len(scores)
