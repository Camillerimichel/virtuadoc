from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from document_engine.model_types import OcrBlock


class OcrEngine:
    _shared_instances: dict[str, Any] = {}

    def __init__(self, language: str = "fr") -> None:
        self.language = language
        self._ocr = None

    def _lazy_init(self) -> None:
        if self._ocr is not None:
            return
        shared = self._shared_instances.get(self.language)
        if shared is not None:
            self._ocr = shared
            return
        from paddleocr import PaddleOCR  # lazy import to keep startup lightweight
        os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

        # PaddleOCR args vary between major versions; keep a backward-compatible init.
        for kwargs in (
            {
                "lang": self.language,
                "text_detection_model_name": "PP-OCRv5_mobile_det",
                "text_recognition_model_name": "latin_PP-OCRv5_mobile_rec",
                "use_doc_orientation_classify": False,
                "use_doc_unwarping": False,
                "use_textline_orientation": False,
                "enable_mkldnn": False,
            },
            {"lang": self.language, "enable_mkldnn": False},
            {"use_angle_cls": True, "lang": self.language, "show_log": False},
            {"use_angle_cls": True, "lang": self.language},
        ):
            try:
                self._ocr = PaddleOCR(**kwargs)
                self._shared_instances[self.language] = self._ocr
                return
            except Exception:
                continue
        raise RuntimeError("Impossible d'initialiser PaddleOCR avec les paramètres supportés")

    def run(self, pdf_path: Path) -> list[OcrBlock]:
        self._lazy_init()
        raw_result: Any
        try:
            raw_result = self._ocr.predict(
                str(pdf_path),
                text_det_limit_side_len=736,
                text_det_limit_type="max",
            )
        except TypeError:
            try:
                raw_result = self._ocr.ocr(str(pdf_path))
            except TypeError:
                raw_result = self._ocr.ocr(str(pdf_path), cls=True)
        return self._parse_raw_result(raw_result)

    def run_regions(self, pdf_path: Path, regions: list[dict[str, Any]]) -> list[OcrBlock]:
        self._lazy_init()
        planned_regions = self._plan_regions(regions)
        if not planned_regions:
            return []

        page_images = self._render_pdf_pages(pdf_path, {region["page"] for region in planned_regions})
        blocks: list[OcrBlock] = []
        for region in planned_regions:
            image = page_images.get(region["page"])
            if image is None:
                continue
            blocks.extend(self._run_single_region(image, region))
        return blocks

    def _parse_raw_result(
        self,
        raw_result: Any,
        default_page: int = 1,
        force_page: int | None = None,
        offset_x: float = 0.0,
        offset_y: float = 0.0,
    ) -> list[OcrBlock]:
        blocks: list[OcrBlock] = []
        pages = self._normalize_pages(raw_result)
        for page_idx, page in enumerate(pages, start=default_page):
            if page is None:
                continue
            current_page = force_page if force_page is not None else page_idx
            if isinstance(page, dict) and "rec_texts" in page and "dt_polys" in page:
                blocks.extend(self._parse_predict_page(page, current_page, offset_x=offset_x, offset_y=offset_y))
                continue
            blocks.extend(self._parse_legacy_page(page, current_page, offset_x=offset_x, offset_y=offset_y))
        return blocks

    def _normalize_pages(self, raw_result: Any) -> list[Any]:
        if raw_result is None:
            return []
        if isinstance(raw_result, dict):
            return [raw_result]
        if isinstance(raw_result, list):
            if not raw_result:
                return []
            first = raw_result[0]
            if isinstance(first, dict) and "rec_texts" in first and "dt_polys" in first:
                return raw_result
            if self._looks_like_legacy_line(first):
                return [raw_result]
            return raw_result
        return [raw_result]

    def _parse_predict_page(
        self,
        page: dict[str, Any],
        default_page: int,
        offset_x: float = 0.0,
        offset_y: float = 0.0,
    ) -> list[OcrBlock]:
        rec_texts = page.get("rec_texts") or []
        rec_scores = page.get("rec_scores") or []
        dt_polys = page.get("dt_polys") or []
        page_idx = default_page
        items = min(len(rec_texts), len(dt_polys))
        parsed: list[OcrBlock] = []
        for idx in range(items):
            text = str(rec_texts[idx]).strip()
            if not text:
                continue
            raw_bbox = dt_polys[idx]
            if raw_bbox is None:
                continue
            bbox = [[float(p[0]) + offset_x, float(p[1]) + offset_y] for p in raw_bbox]
            score = float(rec_scores[idx]) if idx < len(rec_scores) else 0.0
            parsed.append(OcrBlock(text=text, page=page_idx, confidence=score, bounding_box=bbox))
        return parsed

    def _parse_legacy_page(
        self,
        page: Any,
        page_idx: int,
        offset_x: float = 0.0,
        offset_y: float = 0.0,
    ) -> list[OcrBlock]:
        parsed: list[OcrBlock] = []
        for line in page:
            bbox = [[float(p[0]) + offset_x, float(p[1]) + offset_y] for p in line[0]]
            text = str(line[1][0]).strip()
            conf = float(line[1][1])
            if not text:
                continue
            parsed.append(OcrBlock(text=text, page=page_idx, confidence=conf, bounding_box=bbox))
        return parsed

    def _predict_image(self, image: Any) -> Any:
        try:
            return self._ocr.predict(
                image,
                text_det_limit_side_len=736,
                text_det_limit_type="max",
            )
        except TypeError:
            try:
                return self._ocr.ocr(image)
            except TypeError:
                return self._ocr.ocr(image, cls=True)

    def _plan_regions(self, regions: list[dict[str, Any]]) -> list[dict[str, float | int | str]]:
        planned: list[dict[str, float | int | str]] = []
        for region in regions:
            if not isinstance(region, dict):
                continue
            pages = self._parse_pages(region.get("pages"))
            if not pages:
                pages = {1}
            for page in pages:
                planned.append(
                    {
                        "name": str(region.get("name", "")).strip(),
                        "page": page,
                        "x_pct": self._safe_pct(region.get("x_pct")),
                        "y_pct": self._safe_pct(region.get("y_pct")),
                        "width_pct": self._safe_pct(region.get("width_pct")),
                        "height_pct": self._safe_pct(region.get("height_pct")),
                        "margin_pct": self._safe_pct(region.get("margin_pct", 0.0)),
                        "anchor_text": str(region.get("anchor_text", "")).strip(),
                        "anchor_mode": self._normalize_anchor_mode(region.get("anchor_mode")),
                        "anchor_search_radius_pct": self._safe_pct(region.get("anchor_search_radius_pct", 0.0)),
                    }
                )
        return planned

    def _render_pdf_pages(self, pdf_path: Path, pages: set[int]) -> dict[int, Any]:
        try:
            import cv2
        except ModuleNotFoundError as exc:
            raise RuntimeError("opencv-python-headless is required for OCR region rendering") from exc

        rendered: dict[int, Any] = {}
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            for page in sorted(pages):
                prefix = temp_path / f"page_{page}"
                subprocess.run(
                    [
                        "pdftoppm",
                        "-png",
                        "-f",
                        str(page),
                        "-l",
                        str(page),
                        str(pdf_path),
                        str(prefix),
                    ],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                candidates = sorted(temp_path.glob(f"{prefix.name}-*.png"))
                if not candidates:
                    continue
                image = cv2.imread(str(candidates[0]))
                if image is not None:
                    rendered[page] = image
        return rendered

    def _crop_region(self, image: Any, region: dict[str, float | int | str]) -> tuple[Any | None, int, int]:
        return self._crop_region_with_extra_margin(image, region, 0.0)

    def _crop_region_with_extra_margin(
        self,
        image: Any,
        region: dict[str, float | int | str],
        extra_margin_pct: float,
    ) -> tuple[Any | None, int, int]:
        height, width = image.shape[:2]
        x_pct = float(region["x_pct"])
        y_pct = float(region["y_pct"])
        width_pct = float(region["width_pct"])
        height_pct = float(region["height_pct"])
        margin_pct = float(region["margin_pct"]) + max(0.0, extra_margin_pct)

        x_margin = int(round(width * (margin_pct / 100.0)))
        y_margin = int(round(height * (margin_pct / 100.0)))
        x0 = max(0, int(round(width * (x_pct / 100.0))) - x_margin)
        y0 = max(0, int(round(height * (y_pct / 100.0))) - y_margin)
        x1 = min(width, int(round(width * ((x_pct + width_pct) / 100.0))) + x_margin)
        y1 = min(height, int(round(height * ((y_pct + height_pct) / 100.0))) + y_margin)
        if x1 <= x0 or y1 <= y0:
            return None, 0, 0
        return image[y0:y1, x0:x1], x0, y0

    def _run_single_region(self, image: Any, region: dict[str, float | int | str]) -> list[OcrBlock]:
        initial_crop, offset_x, offset_y = self._crop_region(image, region)
        if initial_crop is None:
            return []
        initial_blocks = self._predict_crop(initial_crop, int(region["page"]), offset_x, offset_y)
        self._tag_region_name(initial_blocks, str(region.get("name", "")).strip())

        anchor_text = str(region.get("anchor_text", "")).strip()
        if not anchor_text:
            return initial_blocks
        if self._contains_anchor(initial_blocks, anchor_text, str(region.get("anchor_mode", "contains"))):
            return initial_blocks

        search_radius_pct = float(region.get("anchor_search_radius_pct", 0.0))
        if search_radius_pct <= 0:
            return initial_blocks

        expanded_crop, expanded_offset_x, expanded_offset_y = self._crop_region_with_extra_margin(
            image,
            region,
            search_radius_pct,
        )
        if expanded_crop is None:
            return initial_blocks
        expanded_blocks = self._predict_crop(
            expanded_crop,
            int(region["page"]),
            expanded_offset_x,
            expanded_offset_y,
        )
        self._tag_region_name(expanded_blocks, str(region.get("name", "")).strip())
        if self._contains_anchor(expanded_blocks, anchor_text, str(region.get("anchor_mode", "contains"))):
            return expanded_blocks
        return initial_blocks

    def _predict_crop(self, crop: Any, page: int, offset_x: int, offset_y: int) -> list[OcrBlock]:
        raw_result = self._predict_image(crop)
        return self._parse_raw_result(
            raw_result,
            default_page=page,
            force_page=page,
            offset_x=offset_x,
            offset_y=offset_y,
        )

    def _safe_pct(self, value: Any) -> float:
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return 0.0
        return max(0.0, min(100.0, numeric))

    def _normalize_anchor_mode(self, value: Any) -> str:
        mode = str(value or "contains").strip().lower()
        if mode in {"contains", "exact", "regex"}:
            return mode
        return "contains"

    def _parse_pages(self, value: Any) -> set[int]:
        if value is None:
            return set()
        raw = str(value).strip()
        if not raw:
            return set()
        pages: set[int] = set()
        for chunk in raw.replace(";", ",").split(","):
            part = chunk.strip()
            if not part:
                continue
            if "-" in part:
                left, right = part.split("-", 1)
                start = self._safe_int(left)
                end = self._safe_int(right)
                if start <= 0 or end <= 0:
                    continue
                low, high = sorted((start, end))
                pages.update(range(low, high + 1))
                continue
            page = self._safe_int(part)
            if page > 0:
                pages.add(page)
        return pages

    def _safe_int(self, value: Any) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0

    def _looks_like_legacy_line(self, value: Any) -> bool:
        if not isinstance(value, (list, tuple)) or len(value) < 2:
            return False
        return isinstance(value[0], (list, tuple))

    def _contains_anchor(self, blocks: list[OcrBlock], anchor_text: str, mode: str) -> bool:
        if not anchor_text:
            return False
        needle = " ".join(anchor_text.lower().split())
        for block in blocks:
            haystack = " ".join(block.text.lower().split())
            if mode == "exact" and haystack == needle:
                return True
            if mode == "regex":
                import re

                try:
                    if re.search(anchor_text, block.text, flags=re.IGNORECASE):
                        return True
                except re.error:
                    continue
            if mode == "contains" and needle in haystack:
                return True
        return False

    def _tag_region_name(self, blocks: list[OcrBlock], region_name: str) -> None:
        if not region_name:
            return
        for block in blocks:
            block.region_name = region_name
