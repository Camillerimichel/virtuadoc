from __future__ import annotations

import re
from collections import defaultdict

from rapidfuzz import fuzz

from document_engine.model_types import DetectionResult, LayoutZone


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
        known_field_names = {
            " ".join(str(element.get("name", "")).lower().split())
            for element in required_elements
            if str(element.get("name", "")).strip()
        }
        page_text = defaultdict(str)
        zones_by_page: dict[int, list[LayoutZone]] = defaultdict(list)

        for zone in zones:
            page_text[zone.page] += f"\n{zone.text}"
            zones_by_page[zone.page].append(zone)

        if ocr_texts:
            page_text[1] += "\n" + "\n".join(ocr_texts)

        for element in required_elements:
            name = element["name"]
            strategy = str(element.get("strategy", "keyword"))
            allowed_pages = self._parse_allowed_pages(element.get("pages"))
            if strategy == "relative_anchor":
                result = self._detect_relative_anchor(
                    name,
                    element,
                    zones_by_page,
                    known_field_names,
                    allowed_pages,
                )
            else:
                aliases = self._aliases_for(name)
                match_mode = str(element.get("match_mode", "contains"))
                result = self._detect_one(
                    name,
                    aliases,
                    match_mode,
                    page_text,
                    zones_by_page,
                    known_field_names,
                    allowed_pages,
                )
            if result:
                findings.append(result)

        findings.extend(self._detect_visual_hints(page_text))
        deduped: dict[str, DetectionResult] = {}
        for result in findings:
            deduped[result.name] = result
        return list(deduped.values())

    def _detect_one(
        self,
        name: str,
        aliases: list[str],
        match_mode: str,
        page_text: dict[int, str],
        zones_by_page: dict[int, list[LayoutZone]],
        known_field_names: set[str],
        allowed_pages: set[int] | None,
    ) -> DetectionResult | None:
        for page, zones in zones_by_page.items():
            if allowed_pages is not None and page not in allowed_pages:
                continue
            sorted_zones = sorted(zones, key=lambda zone: (-zone.y1, zone.x0))
            best_result: DetectionResult | None = None
            best_score = -1
            for zone in sorted_zones:
                if any(self._match_mode(zone.text, alias, match_mode) for alias in aliases):
                    right_zone = self._find_right_candidate(zone, sorted_zones)
                    below_zone = self._find_below_candidate(zone, sorted_zones)
                    below_right_zone = self._find_right_candidate(below_zone, sorted_zones) if below_zone else None
                    inline_value = self._extract_inline_value(zone.text, aliases, known_field_names)
                    right_text = self._clean_preview_text(right_zone.text) if right_zone else None
                    below_text = self._clean_preview_text(below_zone.text) if below_zone else None
                    below_right_text = self._clean_preview_text(below_right_zone.text) if below_right_zone else None

                    value = None
                    value_pos = None
                    if inline_value:
                        value = inline_value
                        value_pos = "right"
                    elif right_text:
                        normalized = self._normalize_candidate_text(right_text, aliases, known_field_names)
                        if normalized:
                            value = normalized
                            value_pos = "right"
                    elif below_right_text:
                        normalized = self._normalize_candidate_text(below_right_text, aliases, known_field_names)
                        if normalized:
                            value = normalized
                            value_pos = "below_right"
                    elif below_text:
                        normalized = self._normalize_candidate_text(below_text, aliases, known_field_names)
                        if normalized:
                            value = normalized
                            value_pos = "below"

                    meta: dict[str, str] = {}
                    if value:
                        meta["field_value"] = value
                    if value_pos:
                        meta["value_position"] = value_pos
                    if right_text:
                        meta["right_text"] = right_text
                    if below_text:
                        meta["below_text"] = below_text
                    if below_right_text:
                        meta["below_right_text"] = below_right_text
                    candidate_score = 1
                    if value:
                        candidate_score = 3
                    elif right_text or below_text:
                        candidate_score = 2

                    if candidate_score > best_score:
                        best_score = candidate_score
                        best_result = DetectionResult(name=name, page=page, evidence="text-match", meta=meta)
            if best_result is not None:
                return best_result

        for page, content in page_text.items():
            if allowed_pages is not None and page not in allowed_pages:
                continue
            lowered = content.lower()
            fuzzy = max((fuzz.partial_ratio(alias.lower(), lowered) for alias in aliases), default=0)
            if fuzzy >= 90:
                return DetectionResult(name=name, page=page, evidence="fuzzy-match", confidence=fuzzy / 100)

            regex_value = self._regex_search(name, content)
            if regex_value:
                return DetectionResult(
                    name=name,
                    page=page,
                    evidence="regex",
                    meta={"field_value": regex_value, "value_position": "regex"},
                )

        return None

    def _detect_relative_anchor(
        self,
        name: str,
        element: dict,
        zones_by_page: dict[int, list[LayoutZone]],
        known_field_names: set[str],
        allowed_pages: set[int] | None,
    ) -> DetectionResult | None:
        anchor = element.get("anchor", {}) if isinstance(element.get("anchor"), dict) else {}
        move = element.get("move", {}) if isinstance(element.get("move"), dict) else {}
        target = element.get("target", {}) if isinstance(element.get("target"), dict) else {}

        anchor_keyword = str(anchor.get("keyword", "")).strip()
        target_keywords = self._split_keywords(target.get("keyword", ""))
        if not anchor_keyword or not target_keywords:
            return None

        occurrence = max(self._safe_int(anchor.get("occurrence"), 1), 1)
        lines_below = self._safe_int(move.get("lines_below"), 0)
        tolerance = max(self._safe_int(move.get("tolerance"), 0), 0)
        mode = str(target.get("mode", "contains"))

        for page, zones in zones_by_page.items():
            if allowed_pages is not None and page not in allowed_pages:
                continue
            lines = sorted(zones, key=lambda z: (-z.y1, z.x0))
            anchor_hits = [line for line in lines if self._match_mode(line.text, anchor_keyword, "contains")]
            if len(anchor_hits) < occurrence:
                continue

            anchor_line = anchor_hits[occurrence - 1]
            below_lines = self._lines_below_same_column(anchor_line, lines)
            target_idx = lines_below - 1
            start = max(0, target_idx - tolerance)
            end = min(len(below_lines) - 1, target_idx + tolerance)
            if lines_below <= 0 or start > end:
                continue

            for idx in range(start, end + 1):
                line = below_lines[idx]
                if any(self._match_mode(line.text, keyword, mode) for keyword in target_keywords):
                    target_right_zone = self._find_right_candidate(line, lines)
                    target_below_zone = self._find_below_candidate(line, lines)
                    target_right_text = self._clean_preview_text(target_right_zone.text) if target_right_zone else None
                    target_below_text = self._clean_preview_text(target_below_zone.text) if target_below_zone else None
                    extracted_value = (
                        self._normalize_candidate_text(target_right_text or "", [name], known_field_names)
                        or self._normalize_candidate_text(target_below_text or "", [name], known_field_names)
                        or self._normalize_candidate_text(line.text, [name], known_field_names)
                        or line.text
                    )

                    return DetectionResult(
                        name=name,
                        page=page,
                        evidence="relative-anchor",
                        meta={
                            "field_value": extracted_value,
                            "value_position": "target_right_or_below",
                            "anchor_text": anchor_line.text,
                            "target_text": line.text,
                            "lines_below": str(lines_below),
                            "target_right_text": target_right_text or "",
                            "target_below_text": target_below_text or "",
                        },
                    )

        return None

    def _lines_below_same_column(self, anchor_line: LayoutZone, lines: list[LayoutZone]) -> list[LayoutZone]:
        anchor_width = max(anchor_line.x1 - anchor_line.x0, 1.0)
        min_overlap = min(30.0, anchor_width * 0.35)

        def same_column_score(line: LayoutZone) -> tuple[float, float, float]:
            overlap = min(anchor_line.x1, line.x1) - max(anchor_line.x0, line.x0)
            x_center_delta = abs(((line.x0 + line.x1) / 2) - ((anchor_line.x0 + anchor_line.x1) / 2))
            x_left_delta = abs(line.x0 - anchor_line.x0)
            return overlap, x_center_delta, x_left_delta

        pdf_below: list[tuple[float, float, LayoutZone]] = []
        image_below: list[tuple[float, float, LayoutZone]] = []
        for line in lines:
            if line is anchor_line:
                continue
            overlap, x_center_delta, x_left_delta = same_column_score(line)
            if (
                overlap < min_overlap
                and x_center_delta > anchor_width * 0.8
                and x_left_delta > max(30.0, anchor_width * 0.9)
            ):
                continue

            # Native PDF blocks usually use a bottom-left origin, while OCR blocks use a top-left origin.
            if line.y1 <= anchor_line.y0 + 2.0:
                pdf_below.append((anchor_line.y0 - line.y1, x_center_delta, line))
            if line.y0 >= anchor_line.y1 - 2.0:
                image_below.append((line.y0 - anchor_line.y1, x_center_delta, line))

        candidates = pdf_below
        best_pdf_gap = min((gap for gap, _, _ in pdf_below), default=None)
        best_image_gap = min((gap for gap, _, _ in image_below), default=None)
        if image_below and (best_pdf_gap is None or (best_image_gap is not None and best_image_gap < best_pdf_gap)):
            candidates = image_below
        if not candidates:
            return []
        candidates.sort(key=lambda c: (c[0], c[1]))
        return [line for _, _, line in candidates]

    def _aliases_for(self, name: str) -> list[str]:
        aliases = self.global_rules.get("aliases", {}).get(name, [])
        return [name, *aliases]

    def _regex_search(self, name: str, content: str) -> str | None:
        patterns = self.global_rules.get("regex", {}).get(name, [])
        for pattern in patterns:
            match = re.search(pattern, content, flags=re.IGNORECASE)
            if match is None:
                continue
            value = match.group(0).strip()
            if value:
                return value
        return None

    def _match_mode(self, text: str, keyword: str, mode: str) -> bool:
        source = " ".join(text.lower().split())
        needle = " ".join(keyword.lower().split())
        if not needle:
            return False
        if mode == "exact":
            return source == needle
        if mode == "regex":
            try:
                return re.search(keyword, text, flags=re.IGNORECASE) is not None
            except re.error:
                return False
        return needle in source

    def _safe_int(self, value: object, default: int) -> int:
        try:
            return int(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return default

    def _split_keywords(self, value: object) -> list[str]:
        if isinstance(value, str):
            parts = re.split(r"[,;\n|]+", value)
            return [part.strip() for part in parts if part.strip()]
        if isinstance(value, list):
            return [str(part).strip() for part in value if str(part).strip()]
        return []

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

    def _extract_inline_value(self, text: str, aliases: list[str], known_field_names: set[str]) -> str | None:
        lowered = text.lower()
        for alias in aliases:
            marker = f"{alias.lower()}:"
            idx = lowered.find(marker)
            if idx >= 0:
                value = text[idx + len(marker) :].strip(" .:-\t")
                normalized = self._normalize_candidate_text(value, aliases, known_field_names)
                if normalized:
                    return normalized
        if ":" in text:
            right = text.split(":", 1)[1].strip(" .:-\t")
            normalized = self._normalize_candidate_text(right, aliases, known_field_names)
            if normalized:
                return normalized
        return None

    def _normalize_candidate_text(self, text: str, aliases: list[str], known_field_names: set[str]) -> str | None:
        cleaned = " ".join(text.strip().split())
        cleaned = cleaned.strip(" .:-\t")
        if len(cleaned) < 2:
            return None
        if self._is_placeholder_like_text(cleaned):
            return None
        if re.fullmatch(r"\([^)]*\)", cleaned):
            return None
        if self._is_checkbox_choice_text(cleaned):
            return None

        lowered = cleaned.lower()
        if " ".join(lowered.split()) in known_field_names:
            return None
        if any(lowered == alias.lower() for alias in aliases):
            return None
        if any(fuzz.ratio(lowered, alias.lower()) >= 90 for alias in aliases):
            return None
        return cleaned

    def _clean_preview_text(self, text: str) -> str | None:
        cleaned = " ".join(text.strip().split())
        cleaned = cleaned.strip(" .:-\t")
        if len(cleaned) < 1:
            return None
        if self._is_placeholder_like_text(cleaned):
            return None
        if re.fullmatch(r"\([^)]*\)", cleaned):
            return None
        if self._is_checkbox_choice_text(cleaned):
            return None
        return cleaned

    def _find_right_candidate(self, label_zone: LayoutZone, page_zones: list[LayoutZone]) -> LayoutZone | None:
        label_height = max(abs(label_zone.y1 - label_zone.y0), 1.0)
        row_tolerance = max(8.0, label_height * 0.5)
        max_candidate_height = max(48.0, label_height * 2.5)

        candidates = []
        for zone in page_zones:
            if zone is label_zone:
                continue
            if zone.x0 <= label_zone.x1:
                continue
            if abs(zone.y1 - zone.y0) > max_candidate_height:
                continue
            if self._clean_preview_text(zone.text) is None:
                continue

            # For "right", keep only zones that share substantially the same row.
            vertical_overlap = min(label_zone.y1, zone.y1) - max(label_zone.y0, zone.y0)
            if vertical_overlap < row_tolerance:
                continue

            x_gap = zone.x0 - label_zone.x1
            y_center_delta = abs(((zone.y0 + zone.y1) / 2) - ((label_zone.y0 + label_zone.y1) / 2))
            candidates.append((x_gap, y_center_delta, zone))

        if not candidates:
            return None
        candidates.sort(key=lambda c: (c[0], c[1]))
        return candidates[0][2]

    def _find_below_candidate(self, label_zone: LayoutZone, page_zones: list[LayoutZone]) -> LayoutZone | None:
        # PDF coordinates are bottom-left based: lower y means visually below.
        below_tolerance = 3.0
        label_width = max(abs(label_zone.x1 - label_zone.x0), 1.0)
        min_overlap = min(30.0, label_width * 0.5)

        candidates = []
        for zone in page_zones:
            if zone is label_zone:
                continue
            if self._clean_preview_text(zone.text) is None:
                continue

            overlap = min(label_zone.x1, zone.x1) - max(label_zone.x0, zone.x0)
            if overlap < min_overlap:
                continue

            # Must be visually below the label (not above).
            if zone.y1 > label_zone.y0 + below_tolerance:
                continue

            vertical_gap = label_zone.y0 - zone.y1
            # Prefer nearest block below, then best horizontal alignment.
            x_center_delta = abs(((zone.x0 + zone.x1) / 2) - ((label_zone.x0 + label_zone.x1) / 2))
            candidates.append((vertical_gap, x_center_delta, zone))

        if not candidates:
            return None
        candidates.sort(key=lambda c: (c[0], c[1]))
        return candidates[0][2]

    def _is_placeholder_like_text(self, text: str) -> bool:
        compact = re.sub(r"\s+", "", text or "")
        if not compact:
            return True
        if re.search(r"[A-Za-z0-9À-ÿ]", compact):
            return False
        return re.fullmatch(r"[_\-.=~/\\|:]+", compact) is not None

    def _is_checkbox_choice_text(self, text: str) -> bool:
        compact = " ".join((text or "").split())
        if "" not in compact and "☐" not in compact and "☑" not in compact:
            return False
        return True

    def _parse_allowed_pages(self, value: object) -> set[int] | None:
        if value is None:
            return None
        raw = str(value).strip()
        if not raw:
            return None

        pages: set[int] = set()
        for chunk in re.split(r"[;, ]+", raw):
            part = chunk.strip()
            if not part:
                continue
            if "-" in part:
                start_raw, end_raw = part.split("-", 1)
                start = self._safe_int(start_raw, -1)
                end = self._safe_int(end_raw, -1)
                if start <= 0 or end <= 0:
                    continue
                low, high = sorted((start, end))
                pages.update(range(low, high + 1))
                continue
            page = self._safe_int(part, -1)
            if page > 0:
                pages.add(page)

        return pages or None
