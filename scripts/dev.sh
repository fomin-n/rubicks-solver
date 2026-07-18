#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cache_dir="${RUBICKS_SOLVER_CACHE_DIR:-$project_dir/.cache}"

cleanup() {
  if [[ -n "${backend_pid:-}" ]]; then
    kill "$backend_pid" 2>/dev/null || true
    wait "$backend_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

RUBICKS_SOLVER_CACHE_DIR="$cache_dir" uv run --project "$project_dir/backend" \
  uvicorn app.main:app --app-dir "$project_dir/backend" --host 127.0.0.1 --port 8000 --reload &
backend_pid=$!

npm --prefix "$project_dir/frontend" run dev

