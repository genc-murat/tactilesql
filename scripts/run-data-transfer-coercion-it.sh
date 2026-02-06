#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/src-tauri/tests/fixtures/data-transfer-coercion/docker-compose.yml"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to run integration tests" >&2
  exit 1
fi

cleanup() {
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for_healthy() {
  local service="$1"
  local retries=60

  for ((i=1; i<=retries; i++)); do
    local container_id
    container_id="$(docker compose -f "$COMPOSE_FILE" ps -q "$service" 2>/dev/null || true)"
    if [[ -n "$container_id" ]]; then
      local status
      status="$(
        docker inspect \
          --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
          "$container_id" 2>/dev/null || true
      )"
      if [[ "$status" == "healthy" || "$status" == "running" ]]; then
        return 0
      fi
    fi

    sleep 2
  done

  echo "Timed out waiting for $service to become healthy" >&2
  docker compose -f "$COMPOSE_FILE" ps >&2 || true
  return 1
}

echo "Starting MySQL/PostgreSQL integration containers..."
docker compose -f "$COMPOSE_FILE" up -d

wait_for_healthy mysql
wait_for_healthy postgres

export TACTILE_RUN_INTEGRATION_DB_TESTS=1

cargo test \
  --manifest-path "$ROOT_DIR/src-tauri/Cargo.toml" \
  data_transfer::engine::tests::integration_ \
  -- --ignored --nocapture
