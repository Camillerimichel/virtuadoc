from __future__ import annotations

from fastapi import FastAPI

from document_engine.api.analyze_endpoint import router as analyze_router
from document_engine.api.config_endpoint import router as config_router
from document_engine.api.training_endpoint import router as training_router

app = FastAPI(title="Document Completeness Engine", version="0.1.0")
app.include_router(analyze_router)
app.include_router(training_router)
app.include_router(config_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
