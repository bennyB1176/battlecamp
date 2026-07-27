#!/usr/bin/env bash
#
# Scan the repository for committed secrets using gitleaks.
#
# Both the working tree and the full git history are checked: a key that was
# committed and then "removed" in a later commit is still in the history, still
# reachable by anyone who clones the repo, and still needs rotating.
#
# CI runs this exact script, so a local run and a pipeline run cannot disagree.
#
# The binary is pinned to a version *and* a checksum. Fetching a security tool
# over the network with `latest` would mean a compromised release could quietly
# replace the thing whose whole job is to catch problems.

set -euo pipefail

GITLEAKS_VERSION="8.30.1"
GITLEAKS_SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="${REPO_ROOT}/.cache/gitleaks-${GITLEAKS_VERSION}"
BINARY="${CACHE_DIR}/gitleaks"

# Prefer a gitleaks the developer already has installed; only download if not.
if command -v gitleaks >/dev/null 2>&1; then
  BINARY="$(command -v gitleaks)"
elif [[ ! -x "${BINARY}" ]]; then
  case "$(uname -s)" in
    Linux) os="linux" ;;
    Darwin) os="darwin" ;;
    *)
      echo "scan-secrets: unsupported OS $(uname -s). Install gitleaks manually: https://gitleaks.io" >&2
      exit 1
      ;;
  esac

  case "$(uname -m)" in
    x86_64 | amd64) arch="x64" ;;
    arm64 | aarch64) arch="arm64" ;;
    *)
      echo "scan-secrets: unsupported architecture $(uname -m). Install gitleaks manually." >&2
      exit 1
      ;;
  esac

  archive="gitleaks_${GITLEAKS_VERSION}_${os}_${arch}.tar.gz"
  url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${archive}"

  echo "scan-secrets: downloading gitleaks ${GITLEAKS_VERSION} (${os}/${arch})..."
  mkdir -p "${CACHE_DIR}"
  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp}"' EXIT

  curl -sSfL -o "${tmp}/${archive}" "${url}"

  # Only the linux/x64 build is checksum-pinned, because that is the one CI uses
  # and the one this pin was verified against. Other platforms are convenience
  # for local development and fall back to trusting the release download.
  if [[ "${os}" == "linux" && "${arch}" == "x64" ]]; then
    echo "${GITLEAKS_SHA256}  ${tmp}/${archive}" | sha256sum -c - >/dev/null || {
      echo "scan-secrets: checksum mismatch for ${archive} — refusing to run it." >&2
      exit 1
    }
  fi

  tar -xzf "${tmp}/${archive}" -C "${CACHE_DIR}" gitleaks
  chmod +x "${BINARY}"
fi

echo "scan-secrets: using $("${BINARY}" version) at ${BINARY}"

status=0

echo "scan-secrets: scanning working tree..."
"${BINARY}" dir "${REPO_ROOT}" --redact --exit-code 1 || status=$?

echo "scan-secrets: scanning git history..."
"${BINARY}" git "${REPO_ROOT}" --redact --exit-code 1 || status=$?

if [[ "${status}" -ne 0 ]]; then
  cat >&2 <<'MESSAGE'

scan-secrets: potential secrets found (values redacted above).

If it is a real secret:
  1. Rotate it. It is already compromised — removing the commit is not enough.
  2. Then purge it from the history.

If it is a false positive, add a narrow rule to .gitleaks.toml, or mark the
line with:  # gitleaks:allow
MESSAGE
fi

exit "${status}"
