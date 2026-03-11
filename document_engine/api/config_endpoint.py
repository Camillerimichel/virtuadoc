from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from document_engine.config.config_store import ConfigStore

router = APIRouter(prefix="/config", tags=["config"])
store = ConfigStore(Path(__file__).resolve().parents[1] / "config")


class GenericConfigPayload(BaseModel):
    payload: dict[str, Any]


@router.get("/items")
def list_items() -> dict:
    return {"items": store.list_items()}


@router.get("/items/{item}")
def get_item(item: str) -> dict:
    try:
        return {"item": item, "config": store.read_item(item)}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/items/{item}")
def put_item(item: str, body: GenericConfigPayload) -> dict:
    path = store.write_item(item, body.payload)
    return {"status": "ok", "saved_to": str(path)}


@router.delete("/items/{item}")
def delete_item(item: str) -> dict:
    try:
        store.delete_item(item)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.get("/templates")
def list_templates() -> dict:
    return {"templates": store.list_templates()}


@router.get("/templates/{template}")
def get_template(template: str) -> dict:
    try:
        return {"template": template, "config": store.read_template(template)}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/templates/{template}")
def put_template(template: str, body: GenericConfigPayload) -> dict:
    path = store.write_template(template, body.payload)
    return {"status": "ok", "saved_to": str(path)}


@router.get("/global-rules")
def get_global_rules() -> dict:
    return {"config": store.read_global_rules()}


@router.put("/global-rules")
def put_global_rules(body: GenericConfigPayload) -> dict:
    path = store.write_global_rules(body.payload)
    return {"status": "ok", "saved_to": str(path)}
