from __future__ import annotations

import os
from pathlib import Path

from redis import Redis
from rq import Queue

from document_engine.analyzer.pipeline import AnalyzePipeline


def create_queue() -> Queue:
    redis_url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    conn = Redis.from_url(redis_url)
    return Queue("document_engine", connection=conn)


def analyze_job(item: str, base64_pdf: str) -> dict:
    pipeline = AnalyzePipeline(config_dir=Path(__file__).resolve().parents[1] / "config")
    return pipeline.run(item, base64_pdf)
