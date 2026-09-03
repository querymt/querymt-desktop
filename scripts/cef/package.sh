#!/usr/bin/env bash
# Package a Linux CEF build as AppImage, deb, and portable tarball.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

stage_library_family() {
  local name="$1"
  local dest="$2"
  local library=""
  local directory
  local -a library_dirs=()
  IFS=: read -ra library_dirs <<< "${LD_LIBRARY_PATH:-}"
  for directory in "${library_dirs[@]}"; do
    if [ -e "$directory/$name" ]; then
      library="$directory/$name"
      break
    fi
  done
  if [ -z "$library" ]; then
    library="$(ldconfig -p 2>/dev/null | awk -v name="$name" '$1 == name && !found { print $NF; found = 1 }')"
  fi
  if [ -z "$library" ] || [ ! -e "$library" ]; then
    echo "$name not found; install its runtime package before packaging" >&2
    exit 1
  fi

  local real_library
  real_library="$(readlink -f "$library")"
  cp -L "$real_library" "$dest/$(basename "$real_library")"
  ln -sf "$(basename "$real_library")" "$dest/$name"
}

VERSION="${1:-$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' src-tauri/tauri.conf.json | head -1)}"
TARGET_ROOT="${CARGO_TARGET_DIR:-$ROOT/src-tauri/target}"
TARGET="${2:-}"
case "$(uname -m)" in
  x86_64) ARCH=x86_64; PKG_ARCH=amd64; TARGET="${TARGET:-x86_64-unknown-linux-gnu}" ;;
  aarch64 | arm64) ARCH=aarch64; PKG_ARCH=arm64; TARGET="${TARGET:-aarch64-unknown-linux-gnu}" ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

PROFILE_DIR="$TARGET_ROOT/$TARGET/release"
if [ ! -x "$PROFILE_DIR/querymt-desktop" ]; then
  PROFILE_DIR="$TARGET_ROOT/release"
  TARGET=""
fi
BINARY="$PROFILE_DIR/querymt-desktop"
[ -x "$BINARY" ] || { echo "CEF binary not found at $BINARY" >&2; exit 1; }
if ! readelf -d "$BINARY" 2>/dev/null | grep -q 'Shared library: \[libcef\.so\]'; then
  echo "binary at $BINARY is not a CEF build" >&2
  exit 1
fi

bash scripts/cef/stage-runtime.sh release "$PROFILE_DIR"

WORK="$TARGET_ROOT/cef-package-$ARCH"
OUT="$TARGET_ROOT/release/bundle"
RUNTIME="$WORK/runtime"
rm -rf "$WORK"
mkdir -p "$RUNTIME"
rm -rf "$OUT/appimage" "$OUT/deb" "$OUT/tar"
mkdir -p "$OUT/appimage" "$OUT/deb" "$OUT/tar"

cp -a "$PROFILE_DIR"/*.so* "$RUNTIME/" 2>/dev/null || true
cp -a "$PROFILE_DIR"/*.pak "$PROFILE_DIR"/*.dat "$PROFILE_DIR"/*.bin "$PROFILE_DIR"/*.json "$RUNTIME/" 2>/dev/null || true
stage_library_family libxkbcommon-x11.so.0 "$RUNTIME"
stage_library_family libxcb-xkb.so.1 "$RUNTIME"
cp -a "$PROFILE_DIR"/chrome_crashpad_handler "$RUNTIME/" 2>/dev/null || true
cp -a "$PROFILE_DIR"/CEF-LICENSE.txt "$RUNTIME/"
mkdir -p "$RUNTIME/locales"
cp -a "$PROFILE_DIR/locales/en-US.pak" "$RUNTIME/locales/"

for library in "$RUNTIME/libcef.so" "$RUNTIME/libEGL.so" "$RUNTIME/libGLESv2.so"; do
  if [ -f "$library" ]; then
    chmod u+w "$library"
    strip -s "$library"
  fi
done

SIDECAR_TARGET="${TARGET:-$(rustc -vV | sed -n 's/^host: //p')}"
SIDECAR="src-tauri/binaries/qmtcode-$SIDECAR_TARGET"
if [ -x "$SIDECAR" ]; then
  cp "$SIDECAR" "$RUNTIME/"
fi

APPDIR="$WORK/QueryMT.AppDir"
mkdir -p "$APPDIR/usr/bin"
cp -a "$RUNTIME/." "$APPDIR/usr/bin/"
cp "$BINARY" "$APPDIR/usr/bin/querymt-desktop"
cp packaging/querymt-desktop.desktop "$APPDIR/querymt-desktop.desktop"
cp src-tauri/icons/icon.png "$APPDIR/querymt-desktop.png"
cat > "$APPDIR/AppRun" <<'APPRUN'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
export LD_LIBRARY_PATH="$HERE/usr/bin${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

# AppImages cannot install a path-based AppArmor userns profile. Fall back only
# when the host blocks the user namespaces required by Chromium's sandbox.
if ! command -v unshare >/dev/null 2>&1 || ! unshare --user --map-root-user true >/dev/null 2>&1; then
  echo "warning: user namespaces unavailable; starting CEF without the Chromium sandbox" >&2
  set -- --no-sandbox "$@"
fi

exec "$HERE/usr/bin/querymt-desktop" "$@"
APPRUN
chmod 755 "$APPDIR/AppRun" "$APPDIR/usr/bin/querymt-desktop"

APPIMAGETOOL="${APPIMAGETOOL:-$(command -v appimagetool || command -v appimagetool.AppImage || true)}"
[ -n "$APPIMAGETOOL" ] || { echo "appimagetool not found" >&2; exit 1; }
APPIMAGE_ARGS=()
if [ -n "${APPIMAGE_RUNTIME_FILE:-}" ]; then
  [ -f "$APPIMAGE_RUNTIME_FILE" ] || { echo "AppImage runtime not found at $APPIMAGE_RUNTIME_FILE" >&2; exit 1; }
  APPIMAGE_ARGS+=(--runtime-file "$APPIMAGE_RUNTIME_FILE")
fi
ARCH="$ARCH" APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGETOOL" "${APPIMAGE_ARGS[@]}" "$APPDIR" \
  "$OUT/appimage/QueryMT-Desktop-$VERSION-linux-$ARCH.AppImage"

NFPM="${NFPM:-$(command -v nfpm || true)}"
[ -n "$NFPM" ] || { echo "nfpm not found" >&2; exit 1; }
PKGROOT="$WORK/pkgroot"
mkdir -p "$PKGROOT/opt/querymt-desktop" "$PKGROOT/usr/bin" \
  "$PKGROOT/usr/share/applications" "$PKGROOT/usr/share/icons/hicolor/256x256/apps"
cp -a "$RUNTIME/." "$PKGROOT/opt/querymt-desktop/"
cp "$BINARY" "$PKGROOT/opt/querymt-desktop/querymt-desktop"
cat > "$PKGROOT/usr/bin/querymt-desktop" <<'LAUNCHER'
#!/bin/sh
exec /opt/querymt-desktop/querymt-desktop "$@"
LAUNCHER
chmod 755 "$PKGROOT/usr/bin/querymt-desktop" "$PKGROOT/opt/querymt-desktop/querymt-desktop"
cp packaging/querymt-desktop.desktop "$PKGROOT/usr/share/applications/"
cp src-tauri/icons/icon.png "$PKGROOT/usr/share/icons/hicolor/256x256/apps/querymt-desktop.png"
PKGROOT="$PKGROOT" PKG_ARCH="$PKG_ARCH" PKG_VERSION="$VERSION" "$NFPM" pkg \
  -f nfpm.yaml -p deb -t "$OUT/deb/QueryMT-Desktop-$VERSION-linux-$ARCH.deb"

PORTABLE="$WORK/QueryMT-Desktop-$VERSION-linux-$ARCH"
mkdir -p "$PORTABLE"
cp -a "$RUNTIME/." "$PORTABLE/"
cp "$BINARY" "$PORTABLE/querymt-desktop"
tar -C "$WORK" -czf "$OUT/tar/QueryMT-Desktop-$VERSION-linux-$ARCH.tar.gz" \
  "$(basename "$PORTABLE")"

echo "CEF packages written to $OUT"
