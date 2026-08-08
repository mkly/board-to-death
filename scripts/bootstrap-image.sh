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
