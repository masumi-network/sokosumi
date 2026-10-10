#!/usr/bin/env bash
# Put Node 24 ahead of the image's Node 22 (/exec-daemon/node).
# /usr/local/cargo/bin is first on PATH in the Cloud Agent VM.
set -euo pipefail

PREFIX="/opt/node-v24"
LINK_DIR="/usr/local/cargo/bin"

if [[ -x "${PREFIX}/bin/node" ]] && "${PREFIX}/bin/node" -v | grep -q '^v24\.'; then
  for b in node npm npx corepack; do
    sudo ln -sfn "${PREFIX}/bin/${b}" "${LINK_DIR}/${b}"
    sudo ln -sfn "${PREFIX}/bin/${b}" "/usr/local/bin/${b}"
  done
  exit 0
fi

PICKER="$(command -v node || true)"
if [[ -z "${PICKER}" ]]; then
  echo "ensure-node24: node is required to choose the 24.x tarball" >&2
  exit 1
fi

VERSION="$(
  curl -fsSL https://nodejs.org/dist/index.json | "${PICKER}" -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const row=JSON.parse(s).find((r)=>r.version.startsWith("v24.")); if(!row){process.exit(1)} console.log(row.version)})'
)"

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
curl -fsSL "https://nodejs.org/dist/${VERSION}/node-${VERSION}-linux-x64.tar.xz" \
  | tar -xJ -C "${TMP}"
sudo rm -rf "${PREFIX}"
sudo mv "${TMP}/node-${VERSION}-linux-x64" "${PREFIX}"
sudo chown -R "$(id -un):$(id -gn)" "${PREFIX}"

for b in node npm npx corepack; do
  sudo ln -sfn "${PREFIX}/bin/${b}" "${LINK_DIR}/${b}"
  sudo ln -sfn "${PREFIX}/bin/${b}" "/usr/local/bin/${b}"
done

echo "ensure-node24: ${VERSION}"
