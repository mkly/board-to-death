#!/usr/bin/env bash
# Launch an Incus image twice and prove that the application, its service
# lifecycle, HTTP endpoint, runtime configuration, and persistent storage work.
#
# Usage: ./scripts/smoke-incus-image.sh [image-alias]
#
# Set INCUS_STORAGE_POOL when the default profile does not name the pool to use.

set -Eeuo pipefail

readonly IMAGE_ALIAS="${1:-board-to-death}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly REPO_ROOT="${SCRIPT_DIR}/.."
readonly APP_DIR="/opt/board-to-death"
readonly DATA_DIR="/var/lib/board-to-death"
readonly APP_PORT="3000"

STAMP="$(date +%Y%m%d-%H%M%S)-$$"
readonly STAMP
readonly INSTANCE_PREFIX="board-to-death-app-smoke-${STAMP}"
readonly VOLUME_NAME="board-to-death-app-smoke-${STAMP}"
LOG_DIR="$(mktemp -d /tmp/board-to-death-app-smoke.XXXXXX)"
readonly LOG_DIR

CURRENT_INSTANCE=""
CREATED_INSTANCES=()
VOLUME_CREATED=false
SUCCEEDED=false

resolve_storage_pool() {
  local pool="${INCUS_STORAGE_POOL:-}"

  if [[ -z "${pool}" ]]; then
    pool="$(incus profile device get default root pool 2>/dev/null || true)"
  fi
  if [[ -z "${pool}" ]] && incus profile show crabbox-btrfs >/dev/null 2>&1; then
    pool="$(incus profile device get crabbox-btrfs root pool 2>/dev/null || true)"
  fi

  if [[ -z "${pool}" ]]; then
    echo "Could not resolve an Incus storage pool; set INCUS_STORAGE_POOL." >&2
    return 1
  fi

  printf '%s\n' "${pool}"
}

capture_diagnostics() {
  local instance="$1"

  incus info --show-log "${instance}" >"${LOG_DIR}/${instance}-incus.log" 2>&1 || true
  incus exec "${instance}" -- systemctl status --no-pager --full board-to-death.service \
    >"${LOG_DIR}/${instance}-service.log" 2>&1 || true
  incus exec "${instance}" -- journalctl --no-pager -u board-to-death.service -n 300 \
    >"${LOG_DIR}/${instance}-journal.log" 2>&1 || true
}

cleanup() {
  local exit_code=$?
  local instance

  if ((exit_code != 0)) && [[ -n "${CURRENT_INSTANCE}" ]]; then
    capture_diagnostics "${CURRENT_INSTANCE}"
  fi

  for instance in "${CREATED_INSTANCES[@]}"; do
    if incus info "${instance}" >/dev/null 2>&1; then
      incus delete --force "${instance}" >/dev/null 2>&1 || true
    fi
  done

  if [[ "${VOLUME_CREATED}" == true ]]; then
    incus storage volume delete "${STORAGE_POOL}" "${VOLUME_NAME}" >/dev/null 2>&1 || true
  fi

  if ((exit_code == 0)) && [[ "${SUCCEEDED}" == true ]]; then
    rmdir "${LOG_DIR}" 2>/dev/null || true
  else
    echo "Application smoke diagnostics were retained at ${LOG_DIR}" >&2
  fi
}
trap cleanup EXIT

for command_name in incus git tar mktemp date; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command not found: ${command_name}" >&2
    exit 1
  fi
done

if [[ ! -d "${REPO_ROOT}/.git" ]] && ! git -C "${REPO_ROOT}" rev-parse --git-dir >/dev/null 2>&1; then
  echo "Run this script from a Git checkout of board-to-death." >&2
  exit 1
fi
if ! incus image info "${IMAGE_ALIAS}" >/dev/null 2>&1; then
  echo "Incus image alias not found: ${IMAGE_ALIAS}" >&2
  exit 1
fi

STORAGE_POOL="$(resolve_storage_pool)"
readonly STORAGE_POOL

wait_for_system() {
  local instance="$1"
  local state

  for _ in $(seq 60); do
    state="$(incus exec "${instance}" -- systemctl is-system-running 2>/dev/null || true)"
    if [[ "${state}" == "running" ]] || [[ "${state}" == "degraded" ]]; then
      return 0
    fi
    sleep 2
  done

  echo "${instance} did not finish booting." >&2
  return 1
}

wait_for_http() {
  local instance="$1"

  for _ in $(seq 90); do
    if incus exec "${instance}" -- curl --fail --silent --show-error \
      "http://127.0.0.1:${APP_PORT}/auth/login" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  echo "${instance} did not serve the login page on port ${APP_PORT}." >&2
  return 1
}

copy_checkout() {
  local instance="$1"

  incus exec "${instance}" -- install -d -m 0755 "${APP_DIR}"
  git -C "${REPO_ROOT}" ls-files -z |
    tar --null --files-from=- --create --file=- --directory="${REPO_ROOT}" |
    incus exec "${instance}" -- tar --extract --file=- --directory="${APP_DIR}"
}

configure_application() {
  local instance="$1"
  local app_secret

  app_secret="$(incus exec "${instance}" -- sh -c 'cat /proc/sys/kernel/random/uuid /proc/sys/kernel/random/uuid | tr -d "\n-")')"

  incus exec "${instance}" -- sh -c "umask 077; cat > /etc/board-to-death.env" <<EOF
NODE_ENV=development
DATABASE_URL=postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death?schema=public
AUTH_SECRET=${app_secret}
BETTER_AUTH_SECRET=${app_secret}
BETTER_AUTH_URL=http://127.0.0.1:${APP_PORT}
AUTH_ALLOWED_EMAILS=admin@example.com
NEXT_PUBLIC_APP_URL=http://127.0.0.1:${APP_PORT}
EOF

  incus exec "${instance}" -- sh -c "cat > /etc/systemd/system/board-to-death.service" <<EOF
[Unit]
Description=Board to Death application smoke service
After=network-online.target board-to-death-pg-bootstrap.service
Wants=network-online.target
Requires=board-to-death-pg-bootstrap.service

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
EnvironmentFile=/etc/board-to-death.env
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/local/bin/npm run dev -- --hostname 0.0.0.0 --port ${APP_PORT}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

  incus exec "${instance}" -- sh -c \
    "test -e '${DATA_DIR}/instance-marker' || printf '%s\n' '${instance}' > '${DATA_DIR}/instance-marker'"
  incus exec "${instance}" -- sh -c "cd '${APP_DIR}' && npm ci"
  incus exec "${instance}" -- sh -c "set -a; . /etc/board-to-death.env; set +a; cd '${APP_DIR}' && npm run db:deploy"
  incus exec "${instance}" -- systemctl daemon-reload
  incus exec "${instance}" -- systemctl enable --now board-to-death.service
}

launch_application() {
  local instance="$1"

  CURRENT_INSTANCE="${instance}"
  CREATED_INSTANCES+=("${instance}")
  echo "Launching ${instance} from ${IMAGE_ALIAS}..."
  incus launch "${IMAGE_ALIAS}" "${instance}"
  incus config device add "${instance}" app-data disk \
    pool="${STORAGE_POOL}" source="${VOLUME_NAME}" path="${DATA_DIR}"
  wait_for_system "${instance}"
  copy_checkout "${instance}"
  configure_application "${instance}"
  wait_for_http "${instance}"

  if ! incus exec "${instance}" -- systemctl is-active --quiet board-to-death.service; then
    echo "board-to-death.service is not active in ${instance}." >&2
    return 1
  fi
}

echo "Creating persistent volume ${STORAGE_POOL}/${VOLUME_NAME}..."
incus storage volume create "${STORAGE_POOL}" "${VOLUME_NAME}"
VOLUME_CREATED=true

FIRST_INSTANCE="${INSTANCE_PREFIX}-1"
SECOND_INSTANCE="${INSTANCE_PREFIX}-2"
readonly FIRST_INSTANCE SECOND_INSTANCE

launch_application "${FIRST_INSTANCE}"

echo "Exercising stop, start, and restart for ${FIRST_INSTANCE}..."
incus exec "${FIRST_INSTANCE}" -- systemctl stop board-to-death.service
if incus exec "${FIRST_INSTANCE}" -- systemctl is-active --quiet board-to-death.service; then
  echo "board-to-death.service remained active after stop." >&2
  exit 1
fi
if incus exec "${FIRST_INSTANCE}" -- curl --fail --silent "http://127.0.0.1:${APP_PORT}/auth/login" >/dev/null 2>&1; then
  echo "The application still answered after its service stopped." >&2
  exit 1
fi
incus exec "${FIRST_INSTANCE}" -- systemctl start board-to-death.service
wait_for_http "${FIRST_INSTANCE}"
incus exec "${FIRST_INSTANCE}" -- systemctl restart board-to-death.service
wait_for_http "${FIRST_INSTANCE}"

incus delete --force "${FIRST_INSTANCE}"
CURRENT_INSTANCE=""

launch_application "${SECOND_INSTANCE}"
if [[ "$(incus exec "${SECOND_INSTANCE}" -- cat "${DATA_DIR}/instance-marker")" != "${FIRST_INSTANCE}" ]]; then
  echo "The second instance did not recover data written through the persistent Incus volume." >&2
  exit 1
fi

incus delete --force "${SECOND_INSTANCE}"
CURRENT_INSTANCE=""
SUCCEEDED=true

echo "Application smoke passed for two clean ${IMAGE_ALIAS} instances."
