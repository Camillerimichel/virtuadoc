from __future__ import annotations

import base64
from pathlib import Path


class PdfLoader:
    @staticmethod
    def decode_base64_pdf(encoded: str) -> bytes:
        try:
            return base64.b64decode(encoded, validate=True)
        except Exception as exc:
            raise ValueError("Invalid base64 PDF payload") from exc

    @staticmethod
    def persist_temp(pdf_bytes: bytes, output_dir: Path, file_name: str) -> Path:
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / file_name
        path.write_bytes(pdf_bytes)
        return path
