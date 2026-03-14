from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response

from document_engine.api.schemas import BuildItemRequest, RenderPdfPageRequest
from document_engine.config.config_store import ConfigStore
from document_engine.core.pdf_loader import PdfLoader
from document_engine.training.item_builder import ItemBuilder

router = APIRouter(prefix="/training", tags=["training"])
builder = ItemBuilder()
store = ConfigStore(Path(__file__).resolve().parents[1] / "config")
pdf_loader = PdfLoader()


@router.post("/build-item")
def build_item(payload: BuildItemRequest) -> dict:
    if payload.template not in store.list_templates():
        raise HTTPException(
            status_code=400,
            detail=f"Unknown template '{payload.template}'. Available templates: {store.list_templates()}",
        )

    config = builder.build(
        item=payload.item,
        template=payload.template,
        language=payload.language,
        threshold=payload.threshold,
        docs=payload.documents,
        document_type=payload.document_type,
        excel_header_axis=payload.excel_header_axis,
    )
    path = builder.save(config, Path(__file__).resolve().parents[1] / "config" / "items")
    return {"status": "ok", "item": payload.item, "saved_to": str(path), "config": config}


@router.post("/render-pdf-page")
def render_pdf_page(payload: RenderPdfPageRequest) -> Response:
    try:
        pdf_bytes = pdf_loader.decode_base64_pdf(payload.document)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            pdf_path = temp_path / "preview.pdf"
            prefix = temp_path / "page"
            pdf_path.write_bytes(pdf_bytes)

            page_count = _pdf_page_count(pdf_path)
            page = min(max(payload.page, 1), page_count or payload.page)
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
            candidates = sorted(temp_path.glob("page-*.png"))
            if not candidates:
                raise RuntimeError("No rendered page produced")
            image_bytes = candidates[0].read_bytes()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="pdftoppm/pdfinfo is not available on the server") from exc
    except subprocess.CalledProcessError as exc:
        raise HTTPException(status_code=500, detail="Unable to render PDF preview") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return Response(
        content=image_bytes,
        media_type="image/png",
        headers={
            "X-Page-Count": str(page_count or page),
            "X-Page-Number": str(page),
        },
    )


def _pdf_page_count(pdf_path: Path) -> int:
    try:
        completed = subprocess.run(
            ["pdfinfo", str(pdf_path)],
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return 0
    except subprocess.CalledProcessError:
        return 0
    for line in completed.stdout.splitlines():
        if line.startswith("Pages:"):
            try:
                return int(line.split(":", 1)[1].strip())
            except ValueError:
                return 0
    return 0
