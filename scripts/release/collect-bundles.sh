#!/usr/bin/env bash
# Collect the installers, updater artifacts and updater signatures of one build
# job into dist/ with predictable names (design D5):
#
#   <ASSET_PREFIX>-<VERSION_NAME>-<ASSET_SUFFIX><ext>
#
# VERSION_NAME is `vX.Y.Z` for stable or `nightly` for the rolling release, so
# the rolling release URLs stay stable and the feed (latest.json) is the source
# of truth for the version.
#
# Environment:
#   RUNTIME        wry | cef
#   TARGET         Rust target triple (decides which bundles are expected)
#   ASSET_PREFIX   e.g. QueryMT-Desktop, QueryMT-Desktop-wry, QueryMT-Desktop-cef
#   ASSET_SUFFIX   e.g. macos-aarch64, windows-x64-setup, linux-x86_64
#   VERSION_NAME   vX.Y.Z | nightly
#   CARGO_TARGET_DIR   optional, default src-tauri/target
#   DIST               optional, default dist
#   REQUIRE_UPDATER_SIGNATURE=1   fail when an updater artifact has no .sig
#
# Expected bundles:
#   wry, *-apple-darwin   dmg, app.tar.gz (+ .sig)
#   wry, *-windows-*      NSIS setup exe (+ .sig)
#   wry, *-linux-*        AppImage (+ .sig), deb
#   cef                   AppImage (+ .sig), deb, portable tar.gz
set -euo pipefail

: "${RUNTIME:?RUNTIME is required (wry|cef)}"
: "${TARGET:?TARGET is required}"
: "${ASSET_PREFIX:?ASSET_PREFIX is required}"
: "${ASSET_SUFFIX:?ASSET_SUFFIX is required}"
: "${VERSION_NAME:?VERSION_NAME is required}"

TARGET_ROOT="${CARGO_TARGET_DIR:-src-tauri/target}"
DIST="${DIST:-dist}"
mkdir -p "$DIST"
shopt -s nullglob

die() {
  echo "::error::collect-bundles: $*" >&2
  exit 1
}

case "$RUNTIME" in
  wry) BUNDLE="$TARGET_ROOT/$TARGET/release/bundle" ;;
  cef) BUNDLE="$TARGET_ROOT/release/bundle" ;;
  *) die "RUNTIME must be wry or cef, got '$RUNTIME'" ;;
esac
[ -d "$BUNDLE" ] || die "bundle directory $BUNDLE does not exist"

collected=0

# collect <dir> <glob> <ext> [updater]
# Copies the single file matching <dir>/<glob> to dist/ and, for updater
# artifacts, its .sig. Exactly one match is required: several would make the
# asset name ambiguous.
collect() {
  local dir="$1" glob="$2" ext="$3" updater="${4:-}"
  local -a matches=("$BUNDLE/$dir"/$glob)
  [ "${#matches[@]}" -eq 1 ] \
    || die "expected exactly one $BUNDLE/$dir/$glob, found ${#matches[@]}"

  local source="${matches[0]}"
  local name="${ASSET_PREFIX}-${VERSION_NAME}-${ASSET_SUFFIX}${ext}"
  cp "$source" "$DIST/$name"
  collected=$((collected + 1))

  if [ -n "$updater" ]; then
    if [ -s "$source.sig" ]; then
      cp "$source.sig" "$DIST/$name.sig"
    elif [ "${REQUIRE_UPDATER_SIGNATURE:-}" = "1" ]; then
      die "updater artifact $source has no .sig (is TAURI_SIGNING_PRIVATE_KEY set?)"
    else
      echo "warning: $source has no .sig; it will not be usable as an update" >&2
    fi
  fi
}

if [ "$RUNTIME" = cef ]; then
  collect appimage '*.AppImage' .AppImage updater
  collect deb '*.deb' .deb
  collect tar '*.tar.gz' .tar.gz
else
  case "$TARGET" in
    *-apple-darwin)
      collect dmg '*.dmg' .dmg
      collect macos '*.app.tar.gz' .app.tar.gz updater
      ;;
    *-windows-*)
      collect nsis '*.exe' .exe updater
      ;;
    *-linux-*)
      collect appimage '*.AppImage' .AppImage updater
      collect deb '*.deb' .deb
      ;;
    *) die "unsupported target '$TARGET'" ;;
  esac
fi

[ "$collected" -gt 0 ] || die "no bundles collected for $TARGET ($RUNTIME)"
ls -l "$DIST"
