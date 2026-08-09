#!/usr/bin/env bash
# Build, smoke-test, and (re)publish the shared board-to-death Incus image
# from ./distrobuilder.yml. Run as your normal Incus user; it invokes sudo
# only for distrobuilder, which refuses to run as anything but root.
#
# Usage: ./scripts/bootstrap-image.sh

set -Eeuo pipefail

readonly IMAGE_ALIAS="board-to-death"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly REPO_ROOT="${SCRIPT_DIR}/.."
readonly DEFINITION="${REPO_ROOT}/distrobuilder.yml"

BUILD_DIR=""
SMOKE_INSTANCE=""
STAGING_ALIAS=""
ROLLBACK_ALIAS=""
PRODUCTION_ALIAS_REMOVED=false
PROMOTED=false

cleanup() {
  local exit_code=$?

  if [[ -n "${SMOKE_INSTANCE}" ]] && incus info "${SMOKE_INSTANCE}" >/dev/null 2>&1; then
    incus delete --force "${SMOKE_INSTANCE}" >/dev/null
  fi

  if ((exit_code != 0)); then
    if [[ "${PROMOTED}" == true ]] && [[ -n "${ROLLBACK_ALIAS}" ]]; then
      echo "Restoring ${IMAGE_ALIAS} from ${ROLLBACK_ALIAS}..." >&2
      incus image alias delete "${IMAGE_ALIAS}" || true
      incus image alias rename "${ROLLBACK_ALIAS}" "${IMAGE_ALIAS}" || true
    elif [[ "${PRODUCTION_ALIAS_REMOVED}" == true ]] && [[ -n "${ROLLBACK_ALIAS}" ]]; then
      echo "Restoring ${IMAGE_ALIAS} from ${ROLLBACK_ALIAS}..." >&2
      incus image alias rename "${ROLLBACK_ALIAS}" "${IMAGE_ALIAS}" || true
    elif [[ -n "${STAGING_ALIAS}" ]]; then
      incus image alias delete "${STAGING_ALIAS}" >/dev/null 2>&1 || true
    fi

    if [[ -n "${BUILD_DIR}" ]]; then
      echo "Build artifacts were retained at ${BUILD_DIR}" >&2
    fi
  else
    if [[ "${BUILD_DIR}" =~ ^/tmp/board-to-death-image-build\.[a-zA-Z0-9]+$ ]] && [[ -d "${BUILD_DIR}" ]]; then
      sudo rm -f "${BUILD_DIR}/incus.tar.xz" "${BUILD_DIR}/rootfs.squashfs"
      rmdir "${BUILD_DIR}" 2>/dev/null || true
    fi
  fi
}
trap cleanup EXIT

if ((EUID == 0)); then
  echo "Run this script as your normal Incus user; it invokes sudo only for distrobuilder." >&2
  exit 1
fi

for command_name in sudo distrobuilder incus awk mktemp; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command not found: ${command_name}" >&2
    exit 1
  fi
done

if [[ ! -r "${DEFINITION}" ]]; then
  echo "Definition file not found: ${DEFINITION}" >&2
  exit 1
fi

# The image is a reusable development base. Runtime secrets belong to each
# leased instance, never to the image definition where every consumer could
# recover them. Reject the production-only variables that would be especially
# damaging if they were added as literal assignments.
for secret_name in AUTH_SECRET BETTER_AUTH_SECRET AUTH_MAGIC_LINK_WEBHOOK_TOKEN; do
  if grep -Eq "^[[:space:]]*${secret_name}=" "${DEFINITION}"; then
    echo "The image definition embeds ${secret_name}; provide it at instance runtime instead." >&2
    exit 1
  fi
done

echo "Validating ${DEFINITION}..."
sudo -- distrobuilder validate "${DEFINITION}"

BUILD_DIR="$(mktemp -d /tmp/board-to-death-image-build.XXXXXX)"
echo "Building image in ${BUILD_DIR}..."
sudo -- distrobuilder build-incus "${DEFINITION}" "${BUILD_DIR}" \
  --options image.architecture=x86_64

readonly METADATA_TARBALL="${BUILD_DIR}/incus.tar.xz"
readonly ROOTFS_IMAGE="${BUILD_DIR}/rootfs.squashfs"
sudo chown "$(id -u):$(id -g)" "${METADATA_TARBALL}" "${ROOTFS_IMAGE}" 2>/dev/null || true
if [[ ! -r "${METADATA_TARBALL}" ]] || [[ ! -r "${ROOTFS_IMAGE}" ]]; then
  echo "Expected build artifacts were not produced or are not readable." >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)-$$"
readonly STAMP
STAGING_ALIAS="${IMAGE_ALIAS}-next-${STAMP}"
SMOKE_INSTANCE="board-to-death-smoke-${STAMP}"

echo "Importing ${STAGING_ALIAS}..."
incus image import \
  "${METADATA_TARBALL}" \
  "${ROOTFS_IMAGE}" \
  --alias "${STAGING_ALIAS}"

echo "Inspecting architecture and provenance of ${STAGING_ALIAS}..."
incus image info "${STAGING_ALIAS}"
IMAGE_ARCH="$(incus image info "${STAGING_ALIAS}" | awk '/^Architecture:/ {print $2}')"
if [[ "${IMAGE_ARCH}" != "x86_64" ]]; then
  echo "Expected architecture x86_64, got '${IMAGE_ARCH}'." >&2
  exit 1
fi

echo "Smoke-testing shell, Git, Node.js, npm, and build tooling as a non-root user..."
incus launch "${STAGING_ALIAS}" "${SMOKE_INSTANCE}"

# incus launch returns as soon as the container is running, well before an
# unprivileged login shell can run reliably. Wait for the system bus first.
for _ in $(seq 60); do
  if incus exec "${SMOKE_INSTANCE}" -- systemctl is-system-running >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

incus exec "${SMOKE_INSTANCE}" -- \
  runuser -u nobody -- env PATH=/usr/local/bin:/usr/bin:/bin sh -c \
  'command -v sh && command -v git && git --version && command -v node && node --version && command -v npm && npm --version && command -v cc && cc --version'

echo "Checking image-owned files and enabled boot services..."
for owned_path in \
  /usr/local/sbin/board-to-death-pg-bootstrap:root:root:755 \
  /etc/systemd/system/board-to-death-pg-bootstrap.service:root:root:644; do
  path="${owned_path%%:*}"
  expected_metadata="${owned_path#*:}"
  actual_metadata="$(incus exec "${SMOKE_INSTANCE}" -- stat -c '%U:%G:%a' "${path}")"
  if [[ "${actual_metadata}" != "${expected_metadata}" ]]; then
    echo "Expected ${path} metadata ${expected_metadata}, got ${actual_metadata}." >&2
    exit 1
  fi
done

for enabled_unit in postgresql.service board-to-death-pg-bootstrap.service; do
  if ! incus exec "${SMOKE_INSTANCE}" -- systemctl is-enabled --quiet "${enabled_unit}"; then
    echo "${enabled_unit} is not enabled in the built image." >&2
    exit 1
  fi
done

if incus exec "${SMOKE_INSTANCE}" -- sh -c \
  "grep -R -E '^(AUTH_SECRET|BETTER_AUTH_SECRET|AUTH_MAGIC_LINK_WEBHOOK_TOKEN)=' \
    /etc/environment /etc/default /etc/systemd/system 2>/dev/null"; then
  echo "The built image contains a production runtime secret assignment." >&2
  exit 1
fi

# Crabbox skips its boot-time `apt-get update` -- a 20s package-index download
# that finds nothing to do -- only when the image-ready marker is present *and*
# every tool its readiness check names is installed. A missing piece silently
# costs 20s on every warmup instead of failing, so assert the whole condition.
echo "Smoke-testing Crabbox's prebaked-image fast path..."
if ! incus exec "${SMOKE_INSTANCE}" -- sh -c '
  test -f /var/lib/crabbox/image-ready &&
  test -x /usr/sbin/sshd &&
  test -s /etc/ssl/certs/ca-certificates.crt &&
  command -v curl >/dev/null &&
  command -v git >/dev/null &&
  command -v rsync >/dev/null &&
  command -v jq >/dev/null'; then
  echo "The image does not satisfy Crabbox's prebaked-packages check;" >&2
  echo "its bootstrap would fall back to a full apt-get update." >&2
  exit 1
fi

# is-system-running reports "degraded" as a nonzero exit, which is not fatal
# here; the bootstrap unit's own result is what matters. Wait for the unit to
# leave "activating", then read its verdict.
echo "Smoke-testing the local PostgreSQL server on 127.0.0.1:5432..."
incus exec "${SMOKE_INSTANCE}" -- \
  timeout 180 systemctl is-system-running --wait >/dev/null 2>&1 || true
if ! incus exec "${SMOKE_INSTANCE}" -- \
  systemctl is-active --quiet board-to-death-pg-bootstrap.service; then
  echo "board-to-death-pg-bootstrap.service did not activate:" >&2
  incus exec "${SMOKE_INSTANCE}" -- \
    systemctl status --no-pager --full board-to-death-pg-bootstrap.service >&2 || true
  exit 1
fi

for smoke_db in board_to_death board_to_death_test; do
  # Tolerate a failing psql so the mismatch is reported below rather than
  # aborting the script bare via set -e.
  db_exists="$(
    incus exec "${SMOKE_INSTANCE}" -- \
      env PGPASSWORD=board_to_death psql \
      -h 127.0.0.1 -p 5432 -U board_to_death -d "${smoke_db}" \
      -tAc 'SELECT 1' \
      2>&1 || true
  )"
  if [[ "${db_exists}" != "1" ]]; then
    echo "${smoke_db} is not ready on 127.0.0.1:5432." >&2
    exit 1
  fi
done

postgres_data_directory="$(
  incus exec "${SMOKE_INSTANCE}" -- \
    runuser -u postgres -- psql -tAc 'SHOW data_directory' | tr -d '[:space:]'
)"
if [[ "${postgres_data_directory}" != /var/lib/postgresql/* ]]; then
  echo "PostgreSQL data must live below /var/lib/postgresql, got '${postgres_data_directory}'." >&2
  exit 1
fi
if [[ "$(incus exec "${SMOKE_INSTANCE}" -- stat -c '%U:%G' "${postgres_data_directory}")" != "postgres:postgres" ]]; then
  echo "PostgreSQL data directory is not owned by postgres:postgres." >&2
  exit 1
fi

incus delete --force "${SMOKE_INSTANCE}"
SMOKE_INSTANCE=""

NEW_FINGERPRINT="$(
  incus image info "${STAGING_ALIAS}" |
    awk '/^Fingerprint:/ {print $2}'
)"
if [[ -z "${NEW_FINGERPRINT}" ]]; then
  echo "Could not determine the new image fingerprint." >&2
  exit 1
fi

OLD_FINGERPRINT=""
if incus image info "${IMAGE_ALIAS}" >/dev/null 2>&1; then
  OLD_FINGERPRINT="$(
    incus image info "${IMAGE_ALIAS}" |
      awk '/^Fingerprint:/ {print $2}'
  )"
fi

if [[ -n "${OLD_FINGERPRINT}" ]]; then
  ROLLBACK_ALIAS="${IMAGE_ALIAS}-prev-${STAMP}"
  echo "Preserving the current image as ${ROLLBACK_ALIAS}..."
  incus image alias create "${ROLLBACK_ALIAS}" "${OLD_FINGERPRINT}"

  incus image alias delete "${IMAGE_ALIAS}"
  PRODUCTION_ALIAS_REMOVED=true
fi

echo "Promoting ${STAGING_ALIAS} to ${IMAGE_ALIAS}..."
incus image alias rename "${STAGING_ALIAS}" "${IMAGE_ALIAS}"
STAGING_ALIAS=""
PRODUCTION_ALIAS_REMOVED=false
PROMOTED=true

CURRENT_FINGERPRINT="$(
  incus image info "${IMAGE_ALIAS}" |
    awk '/^Fingerprint:/ {print $2}'
)"
if [[ "${CURRENT_FINGERPRINT}" != "${NEW_FINGERPRINT}" ]]; then
  echo "The production alias does not point to the newly built image." >&2
  exit 1
fi
PROMOTED=false

echo
echo "Installed ${IMAGE_ALIAS} (${NEW_FINGERPRINT})."
if [[ -n "${ROLLBACK_ALIAS}" ]]; then
  echo "Rollback image: ${ROLLBACK_ALIAS}"
  echo "Remove it after verification with: incus image delete ${ROLLBACK_ALIAS}"
fi
