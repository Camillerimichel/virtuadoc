#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/common.sh"

REF="main"
SKIP_PULL="false"
ALLOW_DIRTY="false"

while (($# > 0)); do
  case "$1" in
    --ref)
      REF="${2:-}"
      shift 2
      ;;
    --skip-pull)
      SKIP_PULL="true"
      shift
      ;;
    --allow-dirty)
      ALLOW_DIRTY="true"
      shift
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

require_cmd git
require_cmd docker
require_cmd curl

cd "$ROOT_DIR"

if [[ "$SKIP_PULL" != "true" ]]; then
  log "Synchronisation git sur $REF"
  git fetch origin
  git checkout "$REF"
  git pull --ff-only origin "$REF"
fi

if [[ "$ALLOW_DIRTY" != "true" && -n "$(git status --porcelain)" ]]; then
  fail "Working tree non propre. Commit/stash requis avant déploiement."
fi

log "Build images production"
docker compose "${COMPOSE_FILES[@]}" build --pull virtuadoc document_engine

log "Déploiement containers production"
docker compose "${COMPOSE_FILES[@]}" up -d --remove-orphans virtuadoc document_engine

log "Vérification santé services"
wait_for_http "http://127.0.0.1:8085/" 40 2 || fail "Frontend non disponible sur 127.0.0.1:8085"
wait_for_http "http://127.0.0.1:8090/health" 40 2 || fail "Document engine non disponible sur 127.0.0.1:8090/health"

log "Déploiement production terminé"
docker compose "${COMPOSE_FILES[@]}" ps
