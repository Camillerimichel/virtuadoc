# Document Completeness Engine

Deterministic and auditable document validation engine (PDF + native Excel).

## Run

```bash
cd /var/www/VirtuaDoc
python3 -m venv .venv
source .venv/bin/activate
pip install -r document_engine/requirements.txt
uvicorn document_engine.main:app --host 0.0.0.0 --port 8090 --reload
```

## API

- `POST /analyze`
- `POST /training/build-item`

The engine is deterministic: no trained model is used for scoring, variant matching, or element detection.

Notes:
- `document_type` supports `pdf` (default) and `excel`.
- Excel support is native only (`.xlsx` / `.xlsm`), without OCR.
