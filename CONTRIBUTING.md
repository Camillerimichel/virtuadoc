# Contributing

## Branching

- Protected branch: `main`
- Work on short-lived branches: `feat/...`, `fix/...`, `chore/...`
- Never push directly to `main`

## Commit convention

Use conventional commits:

- `feat: ...`
- `fix: ...`
- `chore: ...`
- `docs: ...`
- `refactor: ...`
- `test: ...`
- `ci: ...`

Examples:

- `feat(engine): add variant matcher thresholds`
- `fix(api): validate base64 payload length`

## Pull Requests

- Open PR against `main`
- Keep PRs focused and small
- Link related issue(s)
- Ensure all CI checks are green
- Request at least 1 review

## Local checks

Web app:

```bash
npm ci
npm run lint
npm run build
```

Document engine:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r document_engine/requirements-ci.txt
python -m compileall -q document_engine
pytest -q document_engine/tests
```
