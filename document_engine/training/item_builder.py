from __future__ import annotations

from collections import Counter
from pathlib import Path
import re
import unicodedata

from document_engine.model_types import LayoutZone
from document_engine.analyzer.structure_detector import StructureDetector
from document_engine.core.excel_extractor import ExcelExtractor
from document_engine.core.layout_parser import LayoutParser
from document_engine.core.pdf_loader import PdfLoader
from document_engine.core.text_extractor import TextExtractor

_REQUIRED_STOP_WORDS = {
    "date",
    "social",
    "code",
    "rue",
    "extrait",
    "gestion",
    "controle",
    "activites",
    "activite",
}

_EXCEL_GENERIC_LABELS = {
    "champ",
    "champs",
    "label",
    "labels",
    "intitule",
    "intitules",
    "cle",
    "cles",
    "key",
    "keys",
    "valeur",
    "valeurs",
    "value",
    "values",
}


class ItemBuilder:
    def __init__(self) -> None:
        self.loader = PdfLoader()
        self.excel_extractor = ExcelExtractor()
        self.extractor = TextExtractor()
        self.layout_parser = LayoutParser()
        self.structure = StructureDetector()

    def build(
        self,
        item: str,
        template: str,
        language: str,
        threshold: float,
        docs: list[str],
        document_type: str = "pdf",
        excel_header_axis: str = "first_row",
    ) -> dict:
        signatures: list[dict] = []
        keyword_counter = Counter()
        page_counter = Counter()
        excel_label_counter = Counter()
        doc_type = document_type if document_type in {"pdf", "excel"} else "pdf"

        for encoded in docs:
            if doc_type == "excel":
                excel_bytes = self.excel_extractor.decode_base64_excel(encoded)
                text, blocks, pages = self.excel_extractor.extract(
                    excel_bytes,
                    header_axis=excel_header_axis,
                )
            else:
                pdf_bytes = self.loader.decode_base64_pdf(encoded)
                text, blocks, pages = self.extractor.extract(pdf_bytes)
            zones = self.layout_parser.build_zones(blocks)
            sig = self.structure.compute_signature(pages, text, zones)
            signatures.append(
                {
                    "page_count": sig.page_count,
                    "dominant_keywords": sig.dominant_keywords,
                    "table_presence": sig.table_presence,
                    "title_patterns": sig.title_patterns,
                }
            )
            page_counter[sig.page_count] += 1
            keyword_counter.update(sig.dominant_keywords)
            if doc_type == "excel":
                excel_label_counter.update(self._extract_excel_labels(zones))

        excel_pairs_preview: list[str] = []
        if doc_type == "excel" and signatures:
            first_doc_encoded = docs[0]
            excel_bytes = self.excel_extractor.decode_base64_excel(first_doc_encoded)
            text, blocks, _ = self.excel_extractor.extract(
                excel_bytes,
                header_axis=excel_header_axis,
            )
            zones = self.layout_parser.build_zones(blocks)
            excel_pairs_preview = self._excel_pairs_preview(zones)

        dominant_keywords = [k for k, _ in keyword_counter.most_common(12)]
        page_mode = page_counter.most_common(1)[0][0]
        if doc_type == "excel":
            excel_labels = [label for label, _ in excel_label_counter.most_common(12)]
            required_elements = self._build_required_elements_from_excel_labels(excel_labels)
        else:
            required_elements = self._build_required_elements(dominant_keywords, signatures)

        return {
            "item": item,
            "language": language,
            "template": template,
            "threshold": threshold,
            "required_elements": required_elements,
            "variants": [f"{item}_v1"],
            "variant_signatures": [
                {
                    "name": f"{item}_v1",
                    "page_count": page_mode,
                    "dominant_keywords": dominant_keywords,
                    "table_presence": any(s["table_presence"] for s in signatures),
                    "title_patterns": signatures[0]["title_patterns"][:5] if signatures else [],
                }
            ],
            "audit": {
                "sample_count": len(docs),
                "page_distribution": dict(page_counter),
                "document_type": doc_type,
                "excel_header_axis": excel_header_axis if doc_type == "excel" else None,
                "excel_pairs_preview": excel_pairs_preview,
            },
        }

    def _build_required_elements(self, dominant_keywords: list[str], signatures: list[dict]) -> list[dict]:
        candidates: list[str] = []
        candidates.extend(dominant_keywords)
        if signatures:
            for title in signatures[0].get("title_patterns", [])[:6]:
                candidates.extend(re.findall(r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\\-]{3,}", title.lower()))

        deduped: list[str] = []
        for token in candidates:
            cleaned = token.strip().lower()
            if len(cleaned) < 4:
                continue
            if cleaned in _REQUIRED_STOP_WORDS:
                continue
            if cleaned not in deduped:
                deduped.append(cleaned)

        top = deduped[:6]
        if not top:
            top = ["document"]
        return [{"name": name, "weight": 1} for name in top]

    def _extract_excel_labels(self, zones: list[LayoutZone]) -> list[str]:
        labels: list[str] = []
        for zone in zones:
            text = " ".join(zone.text.split())
            if ":" not in text:
                continue
            left = text.split(":", 1)[0].strip()
            normalized = self._normalize_excel_label(left)
            if normalized:
                labels.append(normalized)
        return labels

    def _normalize_excel_label(self, label: str) -> str:
        cleaned = " ".join(label.split()).strip(" .:-\t")
        if len(cleaned) < 2:
            return ""

        ascii_label = (
            unicodedata.normalize("NFKD", cleaned)
            .encode("ascii", "ignore")
            .decode("ascii")
            .lower()
        )
        ascii_label = re.sub(r"[^a-z0-9]+", "_", ascii_label).strip("_")
        if ascii_label in _EXCEL_GENERIC_LABELS:
            return ""
        return ascii_label

    def _build_required_elements_from_excel_labels(self, labels: list[str]) -> list[dict]:
        deduped: list[str] = []
        for label in labels:
            if not label or label in deduped:
                continue
            deduped.append(label)
        top = deduped[:10]
        if not top:
            top = ["document"]
        return [{"name": name, "weight": 1} for name in top]

    def save(self, config: dict, config_dir: Path) -> Path:
        import yaml

        config_dir.mkdir(parents=True, exist_ok=True)
        path = config_dir / f"{config['item']}.yml"
        with path.open("w", encoding="utf-8") as f:
            yaml.safe_dump(config, f, allow_unicode=True, sort_keys=False)
        return path

    def _excel_pairs_preview(self, zones: list[LayoutZone], limit: int = 30) -> list[str]:
        pairs: list[str] = []
        seen: set[str] = set()
        for zone in zones:
            text = " ".join(zone.text.split())
            if ":" not in text:
                continue
            if text in seen:
                continue
            seen.add(text)
            pairs.append(text)
            if len(pairs) >= limit:
                break
        return pairs
