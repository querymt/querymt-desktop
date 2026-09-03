#!/usr/bin/env bash
# Stage the CEF runtime next to a built QueryMT executable.
set -euo pipefail

PROFILE="${1:-debug}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_ROOT="${CARGO_TARGET_DIR:-$ROOT/src-tauri/target}"
DEST="${2:-$TARGET_ROOT/$PROFILE}"

case "$(uname -m)" in
  x86_64) CEF_ARCH=x86_64 ;;
  aarch64 | arm64) CEF_ARCH=aarch64 ;;
  *) echo "unsupported CEF architecture: $(uname -m)" >&2; exit 1 ;;
esac

if [ ! -f "$DEST/libcef.so" ]; then
  CEF_DIR="$(
    find "$TARGET_ROOT" -type d -name "cef_linux_$CEF_ARCH" \
      -path "*/$PROFILE/build/*" -print -quit 2>/dev/null || true
  )"
  if [ -z "$CEF_DIR" ] || [ ! -f "$CEF_DIR/libcef.so" ]; then
    echo "CEF runtime not found under $TARGET_ROOT; build with the cef feature first" >&2
    exit 1
  fi

  mkdir -p "$DEST/locales"
  cp -f "$CEF_DIR"/*.so* "$DEST/" 2>/dev/null || true
  cp -f "$CEF_DIR"/*.pak "$CEF_DIR"/*.dat "$CEF_DIR"/*.bin "$CEF_DIR"/*.json "$DEST/" 2>/dev/null || true
  cp -f "$CEF_DIR"/chrome_crashpad_handler "$DEST/" 2>/dev/null || true
  cp -f "$CEF_DIR"/locales/en-US.pak "$DEST/locales/"
fi

[ -f "$DEST/locales/en-US.pak" ] || {
  echo "CEF en-US locale not found under $DEST" >&2
  exit 1
}
cp -f "$ROOT/packaging/licenses/CEF-LICENSE.txt" "$DEST/CEF-LICENSE.txt"

# The setuid helper cannot work from an AppImage and is not needed with user namespaces.
rm -f "$DEST/chrome-sandbox"
