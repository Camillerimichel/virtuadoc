from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException

from document_engine.api.schemas import BuildItemRequest
from document_engine.config.config_store import ConfigStore
from document_engine.training.item_builder import ItemBuilder

router = APIRouter(prefix="/training", tags=["training"])
builder = ItemBuilder()
store = ConfigStore(Path(__file__).resolve().parents[1] / "config")


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
    )
    path = builder.save(config, Path(__file__).resolve().parents[1] / "config" / "items")
    return {"status": "ok", "item": payload.item, "saved_to": str(path), "config": config}
