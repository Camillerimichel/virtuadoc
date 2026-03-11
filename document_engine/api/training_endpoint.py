from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter

from document_engine.api.schemas import BuildItemRequest
from document_engine.training.item_builder import ItemBuilder

router = APIRouter(prefix="/training", tags=["training"])
builder = ItemBuilder()


@router.post("/build-item")
def build_item(payload: BuildItemRequest) -> dict:
    config = builder.build(
        item=payload.item,
        template=payload.template,
        language=payload.language,
        threshold=payload.threshold,
        docs=payload.documents,
    )
    path = builder.save(config, Path(__file__).resolve().parents[1] / "config" / "items")
    return {"status": "ok", "item": payload.item, "saved_to": str(path), "config": config}
