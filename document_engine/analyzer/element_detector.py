from __future__ import annotations

import re
from collections import defaultdict

from rapidfuzz import fuzz

from document_engine.types import DetectionResult, LayoutZone


class ElementDetector:
    def __init__(self, global_rules: dict) -> None:
        self.global_rules = global_rules

    def detect(
        self,
        required_elements: list[dict],
        zones: list[LayoutZone],
        ocr_texts: list[str],
    ) -> list[DetectionResult]:
        findings: list[DetectionResult] = []
        page_text = defaultdict(str)

        for zone in zones:
            page_text[zone.page] += f"\n{zone.text}"

        if ocr_texts:
            page_text[1] += "\n" + "\n".join(ocr_texts)

        for element in required_elements:
            name = element["name"]
            aliases = self._aliases_for(name)
            result = self._detect_one(name, aliases, page_text)
            if result:
                findings.append(result)

        findings.extend(self._detect_visual_hints(page_text))
        deduped: dict[str, DetectionResult] = {}
        for result in findings:
            deduped[result.name] = result
        return list(deduped.values())

    def _detect_one(self, name: str, aliases: list[str], page_text: dict[int, str]) -> DetectionResult | None:
        for page, content in page_text.items():
            lowered = content.lower()
            if any(alias.lower() in lowered for alias in aliases):
                return DetectionResult(name=name, page=page, evidence="text-match")

            fuzzy = max((fuzz.partial_ratio(alias.lower(), lowered) for alias in aliases), default=0)
            if fuzzy >= 90:
                return DetectionResult(name=name, page=page, evidence="fuzzy-match", confidence=fuzzy / 100)

            if self._regex_match(name, content):
                return DetectionResult(name=name, page=page, evidence="regex")

        return None

    def _aliases_for(self, name: str) -> list[str]:
        aliases = self.global_rules.get("aliases", {}).get(name, [])
        return [name, *aliases]

    def _regex_match(self, name: str, content: str) -> bool:
        patterns = self.global_rules.get("regex", {}).get(name, [])
        return any(re.search(pattern, content, flags=re.IGNORECASE) for pattern in patterns)

    def _detect_visual_hints(self, page_text: dict[int, str]) -> list[DetectionResult]:
        visual_results: list[DetectionResult] = []
        visual_map = {
            "signature": ["signature", "signé", "signataire"],
            "checkbox": ["☑", "☐", "cocher", "case"],
            "stamp": ["cachet", "tampon"],
            "logo": ["logo", "axa", "generali", "cardif"],
        }
        for page, content in page_text.items():
            lowered = content.lower()
            for name, hints in visual_map.items():
                if any(hint in lowered for hint in hints):
                    visual_results.append(
                        DetectionResult(name=name, page=page, evidence="visual-hint", confidence=0.8)
                    )
        return visual_results
