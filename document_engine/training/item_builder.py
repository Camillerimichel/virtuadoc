from __future__ import annotations

from collections import Counter
from pathlib import Path

from document_engine.analyzer.structure_detector import StructureDetector
from document_engine.core.layout_parser import LayoutParser
from document_engine.core.pdf_loader import PdfLoader
from document_engine.core.text_extractor import TextExtractor


class ItemBuilder:
    def __init__(self) -> None:
        self.loader = PdfLoader()
        self.extractor = TextExtractor()
        self.layout_parser = LayoutParser()
        self.structure = StructureDetector()

    def build(self, item: str, template: str, language: str, threshold: float, docs: list[str]) -> dict:
        signatures: list[dict] = []
        keyword_counter = Counter()
        page_counter = Counter()

        for encoded in docs:
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

        dominant_keywords = [k for k, _ in keyword_counter.most_common(12)]
        page_mode = page_counter.most_common(1)[0][0]

        return {
            "item": item,
            "language": language,
            "template": template,
            "threshold": threshold,
            "required_elements": [
                {"name": "souscripteur", "weight": 2},
                {"name": "beneficiaire", "weight": 2},
                {"name": "date", "weight": 1},
                {"name": "signature", "weight": 3},
            ],
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
            },
        }

    def save(self, config: dict, config_dir: Path) -> Path:
        import yaml

        config_dir.mkdir(parents=True, exist_ok=True)
        path = config_dir / f"{config['item']}.yml"
        with path.open("w", encoding="utf-8") as f:
            yaml.safe_dump(config, f, allow_unicode=True, sort_keys=False)
        return path
