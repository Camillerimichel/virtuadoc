from __future__ import annotations

from pathlib import Path

import yaml


class ItemLoader:
    def __init__(self, config_dir: Path) -> None:
        self.config_dir = config_dir

    def load_item(self, item_name: str) -> dict:
        item_path = self.config_dir / "items" / f"{item_name}.yml"
        if not item_path.exists():
            raise FileNotFoundError(f"Unknown item '{item_name}'")
        with item_path.open("r", encoding="utf-8") as f:
            item = yaml.safe_load(f) or {}

        template_name = item.get("template")
        if template_name:
            template = self.load_template(template_name)
            merged = {**template, **item}
            if "required_elements" not in merged:
                merged["required_elements"] = template.get("required_elements", [])
            return merged
        return item

    def load_template(self, template_name: str) -> dict:
        template_path = self.config_dir / "templates" / f"{template_name}.yml"
        if not template_path.exists():
            raise FileNotFoundError(f"Unknown template '{template_name}'")
        with template_path.open("r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    def load_global_rules(self) -> dict:
        global_path = self.config_dir / "global" / "rules.yml"
        if not global_path.exists():
            return {}
        with global_path.open("r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
