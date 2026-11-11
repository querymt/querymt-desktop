#!/usr/bin/env bash
# Package a Linux CEF build as AppImage, deb, and portable tarball.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# Updater signing. The AppImage is the self-updatable artifact, so it gets a
# detached .sig made with the Tauri updater key. CI sets
# REQUIRE_UPDATER_SIGNATURE=1 so a missing key fails the build instead of
# publishing an unsigned updater artifact; local builds just skip signing.
HAVE_SIGNING_KEY=0
if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ] || [ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]; then
  HAVE_SIGNING_KEY=1
fi
if [ "${REQUIRE_UPDATER_SIGNATURE:-}" = "1" ] && [ "$HAVE_SIGNING_KEY" != "1" ]; then
  echo "REQUIRE_UPDATER_SIGNATURE=1 but neither TAURI_SIGNING_PRIVATE_KEY nor TAURI_SIGNING_PRIVATE_KEY_PATH is set" >&2
  exit 1
fi

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
XKB_FALLBACK="$WORK/xkb-fallback"
rm -rf "$WORK"
mkdir -p "$RUNTIME" "$XKB_FALLBACK"
rm -rf "$OUT/appimage" "$OUT/deb" "$OUT/tar"
mkdir -p "$OUT/appimage" "$OUT/deb" "$OUT/tar"

cp -a "$PROFILE_DIR"/*.so* "$RUNTIME/" 2>/dev/null || true
cp -a "$PROFILE_DIR"/*.pak "$PROFILE_DIR"/*.dat "$PROFILE_DIR"/*.bin "$PROFILE_DIR"/*.json "$RUNTIME/" 2>/dev/null || true
# winit dlopens libxkbcommon-x11 for the CEF runtime's X11 event loop.
# libxkbcommon-x11 builds keymaps using libxkbcommon's private struct layouts,
# so it must come from the same release as libxkbcommon. Never put it next to
# the binary (RUNPATH=$ORIGIN would pair it with a different host libxkbcommon
# and segfault in xkb_state_update_mask). Keep a matched set in a separate
# directory that the AppImage only uses when the host lacks libxkbcommon-x11.
stage_library_family libxkbcommon.so.0 "$XKB_FALLBACK"
stage_library_family libxkbcommon-x11.so.0 "$XKB_FALLBACK"
stage_library_family libxcb-xkb.so.1 "$XKB_FALLBACK"
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
mkdir -p "$APPDIR/usr/lib/xkb-fallback"
cp -a "$XKB_FALLBACK/." "$APPDIR/usr/lib/xkb-fallback/"
cp "$BINARY" "$APPDIR/usr/bin/querymt-desktop"
cp packaging/querymt-desktop.desktop "$APPDIR/querymt-desktop.desktop"
cp src-tauri/icons/icon.png "$APPDIR/querymt-desktop.png"
cat > "$APPDIR/AppRun" <<'APPRUN'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
export LD_LIBRARY_PATH="$HERE/usr/bin${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

# Only libraries loadable by this AppImage's architecture count; a 32-bit-only
# host copy must not suppress the bundled fallback.
case "$(uname -m)" in
  x86_64) LDCONFIG_ARCH=x86-64; MULTIARCH=x86_64-linux-gnu; ELF_MACHINE=3e ;;
  aarch64 | arm64) LDCONFIG_ARCH=AArch64; MULTIARCH=aarch64-linux-gnu; ELF_MACHINE=b7 ;;
  *) LDCONFIG_ARCH=; MULTIARCH=; ELF_MACHINE= ;;
esac

elf_matches_arch() {
  command -v od >/dev/null 2>&1 || return 0
  [ "$(od -An -tx1 -j4 -N1 "$1" 2>/dev/null | tr -d ' \n')" = 02 ] || return 1
  [ -z "$ELF_MACHINE" ] || [ "$(od -An -tx1 -j18 -N1 "$1" 2>/dev/null | tr -d ' \n')" = "$ELF_MACHINE" ]
}

host_has_library() {
  for ldconfig in ldconfig /sbin/ldconfig /usr/sbin/ldconfig; do
    if command -v "$ldconfig" >/dev/null 2>&1; then
      if [ -n "$LDCONFIG_ARCH" ]; then
        "$ldconfig" -p 2>/dev/null | grep -q "[[:space:]]$1 (libc6,$LDCONFIG_ARCH" && return 0
      fi
      break
    fi
  done
  for dir in ${MULTIARCH:+/usr/lib/$MULTIARCH /lib/$MULTIARCH} /usr/lib64 /lib64 /usr/lib /lib; do
    [ -e "$dir/$1" ] && elf_matches_arch "$dir/$1" && return 0
  done
  return 1
}

# libxkbcommon-x11 must match the libxkbcommon it is paired with. Prefer the
# host's pair; only fall back to the bundled, matched pair when the host has no
# libxkbcommon-x11 at all.
if ! host_has_library libxkbcommon-x11.so.0; then
  export LD_LIBRARY_PATH="$HERE/usr/lib/xkb-fallback:$LD_LIBRARY_PATH"
fi

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
APPIMAGE_FILE="$OUT/appimage/QueryMT-Desktop-cef-$VERSION-linux-$ARCH.AppImage"
ARCH="$ARCH" APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGETOOL" "${APPIMAGE_ARGS[@]}" "$APPDIR" \
  "$APPIMAGE_FILE"

if [ "$HAVE_SIGNING_KEY" = "1" ]; then
  # Bind the signature to the app version, as `tauri build` does for the other
  # artifacts: updaters with `requireSignedVersion` reject unversioned signatures.
  npx --no-install tauri signer sign --app-version "$VERSION" "$APPIMAGE_FILE"
  [ -s "$APPIMAGE_FILE.sig" ] || { echo "updater signature $APPIMAGE_FILE.sig was not created" >&2; exit 1; }
  echo "Signed $APPIMAGE_FILE"
else
  echo "No updater signing key set; $APPIMAGE_FILE is unsigned" >&2
fi

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
cp src-tauri/icons/128x128@2x.png "$PKGROOT/usr/share/icons/hicolor/256x256/apps/querymt-desktop.png"
PKGROOT="$PKGROOT" PKG_ARCH="$PKG_ARCH" PKG_VERSION="$VERSION" "$NFPM" pkg \
  -f nfpm.yaml -p deb -t "$OUT/deb/QueryMT-Desktop-cef-$VERSION-linux-$ARCH.deb"

PORTABLE="$WORK/QueryMT-Desktop-cef-$VERSION-linux-$ARCH"
mkdir -p "$PORTABLE"
cp -a "$RUNTIME/." "$PORTABLE/"
cp "$BINARY" "$PORTABLE/querymt-desktop"
tar -C "$WORK" -czf "$OUT/tar/QueryMT-Desktop-cef-$VERSION-linux-$ARCH.tar.gz" \
  "$(basename "$PORTABLE")"

echo "CEF packages written to $OUT"
