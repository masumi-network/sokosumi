#!/usr/bin/env bash
# Install agent-browser on PATH for Cloud Agent UI proof (verify-sokosumi).
#
# Bare `npm i -g` is unusable here: this image's npm global prefix is `/`.
# Install into $HOME/.npm-global and symlink onto /usr/local/cargo/bin (first
# on PATH for login and non-login shells). Chrome for Testing is required so
# we do not launch /usr/local/bin/google-chrome — that wrapper is computer-use
# (CDP 9222 + shared profile).
set -euo pipefail

VERSION="${AGENT_BROWSER_VERSION:-0.36.0}"
PREFIX="${AGENT_BROWSER_NPM_PREFIX:-$HOME/.npm-global}"
BIN_NAME="agent-browser"

function bin_dir() {
  if [[ -d /usr/local/cargo/bin && -w /usr/local/cargo/bin ]]; then
    echo /usr/local/cargo/bin
    return
  fi
  mkdir -p "${HOME}/.local/bin"
  echo "${HOME}/.local/bin"
}

# engines: node>=24 is for building from source; the published native binary
# runs on this image's Node 22. --loglevel=error hides EBADENGINE noise.
npm install -g --prefix "${PREFIX}" --loglevel=error "agent-browser@${VERSION}"

SRC="${PREFIX}/bin/${BIN_NAME}"
if [[ ! -e "${SRC}" ]]; then
  echo "error: npm did not install ${BIN_NAME} into ${PREFIX}/bin" >&2
  exit 1
fi

DEST_DIR="$(bin_dir)"
ln -sfn "${SRC}" "${DEST_DIR}/${BIN_NAME}"
hash -r 2>/dev/null || true

if ! command -v "${BIN_NAME}" >/dev/null 2>&1; then
  export PATH="${DEST_DIR}:${PREFIX}/bin:${PATH}"
  hash -r 2>/dev/null || true
fi

# Chrome for Testing (idempotent). Skip --with-deps: snapshot Chrome already
# has Linux libraries; apt via this script is not always possible.
agent-browser install

agent-browser --version
