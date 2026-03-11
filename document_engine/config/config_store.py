from __future__ import annotations

from pathlib import Path

import yaml


class ConfigStore:
    def __init__(self, config_dir: Path) -> None:
        self.config_dir = config_dir
        self.items_dir = config_dir / "items"
        self.templates_dir = config_dir / "templates"
        self.global_dir = config_dir / "global"

    def list_items(self) -> list[str]:
        return sorted(p.stem for p in self.items_dir.glob("*.yml"))

    def list_templates(self) -> list[str]:
        return sorted(p.stem for p in self.templates_dir.glob("*.yml"))

    def read_item(self, item: str) -> dict:
        return self._read_yaml(self.items_dir / f"{item}.yml", f"Unknown item '{item}'")

    def write_item(self, item: str, payload: dict) -> Path:
        path = self.items_dir / f"{item}.yml"
        self.items_dir.mkdir(parents=True, exist_ok=True)
        self._write_yaml(path, payload)
        return path

    def delete_item(self, item: str) -> None:
        path = self.items_dir / f"{item}.yml"
        if not path.exists():
            raise FileNotFoundError(f"Unknown item '{item}'")
        path.unlink()

    def read_template(self, template: str) -> dict:
        return self._read_yaml(self.templates_dir / f"{template}.yml", f"Unknown template '{template}'")

    def write_template(self, template: str, payload: dict) -> Path:
        path = self.templates_dir / f"{template}.yml"
        self.templates_dir.mkdir(parents=True, exist_ok=True)
        self._write_yaml(path, payload)
        return path

    def read_global_rules(self) -> dict:
        path = self.global_dir / "rules.yml"
        if not path.exists():
            return {}
        return self._read_yaml(path, "Global rules not found")

    def write_global_rules(self, payload: dict) -> Path:
        path = self.global_dir / "rules.yml"
        self.global_dir.mkdir(parents=True, exist_ok=True)
        self._write_yaml(path, payload)
        return path

    def _read_yaml(self, path: Path, error_message: str) -> dict:
        if not path.exists():
            raise FileNotFoundError(error_message)
        with path.open("r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    def _write_yaml(self, path: Path, payload: dict) -> None:
        with path.open("w", encoding="utf-8") as f:
            yaml.safe_dump(payload, f, allow_unicode=True, sort_keys=False)
