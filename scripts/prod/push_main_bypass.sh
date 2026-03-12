#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/common.sh"

FROM_BRANCH=""
CONFIRM="false"
ALLOW_DIRTY="false"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/prod/push_main_bypass.sh [--from <branch>] [--allow-dirty] --yes

Description:
  Désactive temporairement la protection bloquante de main (checks/review),
  pousse main, puis restaure la protection initiale.

Options:
  --from <branch>   Branche source à merger en fast-forward dans main.
                    Par défaut: branche courante.
  --allow-dirty     Autorise un working tree non propre.
  --yes             Confirmation obligatoire.
EOF
}

while (($# > 0)); do
  case "$1" in
    --from)
      FROM_BRANCH="${2:-}"
      shift 2
      ;;
    --allow-dirty)
      ALLOW_DIRTY="true"
      shift
      ;;
    --yes)
      CONFIRM="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

if [[ "$CONFIRM" != "true" ]]; then
  usage
  fail "Option --yes obligatoire (opération sensible)."
fi

require_cmd git
require_cmd gh

cd "$ROOT_DIR"

if [[ "$ALLOW_DIRTY" != "true" && -n "$(git status --porcelain)" ]]; then
  fail "Working tree non propre. Commit/stash requis, ou relance avec --allow-dirty."
fi

if [[ -z "$FROM_BRANCH" ]]; then
  FROM_BRANCH="$(git branch --show-current)"
fi

REPO="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
PROTECTION_DISABLED="false"

restore_protection() {
  log "Restauration protection main"
  gh api -X PUT "repos/$REPO/branches/main/protection" --input - <<'JSON' >/dev/null
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "CI / Next.js Lint/Build (pull_request)",
      "CI / Document Engine Checks (pull_request)"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON
}

cleanup() {
  if [[ "$PROTECTION_DISABLED" == "true" ]]; then
    restore_protection
  fi
}
trap cleanup EXIT

log "Suppression temporaire checks/review obligatoires sur main"
gh api -X DELETE "repos/$REPO/branches/main/protection/required_status_checks" >/dev/null 2>&1 || true
gh api -X DELETE "repos/$REPO/branches/main/protection/required_pull_request_reviews" >/dev/null 2>&1 || true
PROTECTION_DISABLED="true"

log "Synchronisation git"
git fetch origin
git checkout main
git pull --ff-only origin main

if [[ "$FROM_BRANCH" != "main" ]]; then
  log "Fast-forward main depuis $FROM_BRANCH"
  git merge --ff-only "$FROM_BRANCH"
fi

log "Push origin/main"
git push origin main

restore_protection
PROTECTION_DISABLED="false"
log "Terminé: main poussée et protection restaurée"
