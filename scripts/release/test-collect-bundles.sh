#!/usr/bin/env bash
# Tests for collect-bundles.sh using fake bundle trees (no real build needed).
#
#   scripts/release/test-collect-bundles.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/collect-bundles.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

failures=0
pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1" >&2; failures=$((failures + 1)); }

touch_files() { # dir file...
  local dir="$1"; shift
  mkdir -p "$dir"
  for f in "$@"; do echo "$f" > "$dir/$f"; done
}

run() { # name expect(ok|fail) env... ; uses $root for CARGO_TARGET_DIR and $dist
  local name="$1" expect="$2"; shift 2
  rm -rf "$dist"
  if env CARGO_TARGET_DIR="$root" DIST="$dist" "$@" bash "$script" >/dev/null 2>&1; then
    [ "$expect" = ok ] && pass "$name" || fail "$name (expected failure)"
  else
    [ "$expect" = fail ] && pass "$name" || fail "$name (expected success)"
  fi
}

listing() { (cd "$dist" && ls | sort | tr '\n' ' '); }
expect_listing() { # name expected
  local actual; actual="$(listing)"
  [ "$actual" = "$2" ] && pass "$1" || fail "$1: expected '$2', got '$actual'"
}

dist="$tmp/dist"

# --- macOS (Wry) -------------------------------------------------------------
root="$tmp/mac"
T=aarch64-apple-darwin
b="$root/$T/release/bundle"
touch_files "$b/dmg" "QueryMT Desktop_0.1.11_aarch64.dmg"
touch_files "$b/macos" "QueryMT Desktop.app.tar.gz" "QueryMT Desktop.app.tar.gz.sig"
run "macos collects dmg, app.tar.gz and sig" ok RUNTIME=wry TARGET=$T ASSET_PREFIX=QueryMT-Desktop ASSET_SUFFIX=macos-aarch64 VERSION_NAME=nightly
expect_listing "macos names" "QueryMT-Desktop-nightly-macos-aarch64.app.tar.gz QueryMT-Desktop-nightly-macos-aarch64.app.tar.gz.sig QueryMT-Desktop-nightly-macos-aarch64.dmg "
run "macos stable naming" ok RUNTIME=wry TARGET=$T ASSET_PREFIX=QueryMT-Desktop ASSET_SUFFIX=macos-aarch64 VERSION_NAME=v0.1.11
expect_listing "macos stable names" "QueryMT-Desktop-v0.1.11-macos-aarch64.app.tar.gz QueryMT-Desktop-v0.1.11-macos-aarch64.app.tar.gz.sig QueryMT-Desktop-v0.1.11-macos-aarch64.dmg "

rm "$b/macos/QueryMT Desktop.app.tar.gz.sig"
run "missing sig fails when required" fail RUNTIME=wry TARGET=$T ASSET_PREFIX=QueryMT-Desktop ASSET_SUFFIX=macos-aarch64 VERSION_NAME=nightly REQUIRE_UPDATER_SIGNATURE=1
run "missing sig only warns locally" ok RUNTIME=wry TARGET=$T ASSET_PREFIX=QueryMT-Desktop ASSET_SUFFIX=macos-aarch64 VERSION_NAME=nightly

# --- Windows (Wry) -----------------------------------------------------------
root="$tmp/win"
T=x86_64-pc-windows-msvc
touch_files "$root/$T/release/bundle/nsis" "QueryMT Desktop_0.1.11_x64-setup.exe" "QueryMT Desktop_0.1.11_x64-setup.exe.sig"
run "windows collects setup exe and sig" ok RUNTIME=wry TARGET=$T ASSET_PREFIX=QueryMT-Desktop ASSET_SUFFIX=windows-x64-setup VERSION_NAME=nightly REQUIRE_UPDATER_SIGNATURE=1
expect_listing "windows names" "QueryMT-Desktop-nightly-windows-x64-setup.exe QueryMT-Desktop-nightly-windows-x64-setup.exe.sig "

# --- Linux (Wry) -------------------------------------------------------------
root="$tmp/linux"
T=x86_64-unknown-linux-gnu
b="$root/$T/release/bundle"
touch_files "$b/appimage" "QueryMT Desktop_0.1.11_amd64.AppImage" "QueryMT Desktop_0.1.11_amd64.AppImage.sig"
touch_files "$b/deb" "QueryMT Desktop_0.1.11_amd64.deb"
run "linux wry collects AppImage, sig and deb" ok RUNTIME=wry TARGET=$T ASSET_PREFIX=QueryMT-Desktop-wry ASSET_SUFFIX=linux-x86_64 VERSION_NAME=nightly REQUIRE_UPDATER_SIGNATURE=1
expect_listing "linux wry names" "QueryMT-Desktop-wry-nightly-linux-x86_64.AppImage QueryMT-Desktop-wry-nightly-linux-x86_64.AppImage.sig QueryMT-Desktop-wry-nightly-linux-x86_64.deb "

touch_files "$b/appimage" "Second.AppImage"
run "two AppImages is ambiguous" fail RUNTIME=wry TARGET=$T ASSET_PREFIX=QueryMT-Desktop-wry ASSET_SUFFIX=linux-x86_64 VERSION_NAME=nightly
run "missing bundle dir fails" fail RUNTIME=wry TARGET=aarch64-unknown-linux-gnu ASSET_PREFIX=QueryMT-Desktop-wry ASSET_SUFFIX=linux-aarch64 VERSION_NAME=nightly

# --- Linux (CEF): package.sh names embed the version -------------------------
root="$tmp/cef"
b="$root/release/bundle"
touch_files "$b/appimage" "QueryMT-Desktop-cef-0.1.11-nightly.20261111100000-linux-x86_64.AppImage" "QueryMT-Desktop-cef-0.1.11-nightly.20261111100000-linux-x86_64.AppImage.sig"
touch_files "$b/deb" "QueryMT-Desktop-cef-0.1.11-nightly.20261111100000-linux-x86_64.deb"
touch_files "$b/tar" "QueryMT-Desktop-cef-0.1.11-nightly.20261111100000-linux-x86_64.tar.gz"
run "cef collects AppImage, sig, deb and tar" ok RUNTIME=cef TARGET=x86_64-unknown-linux-gnu ASSET_PREFIX=QueryMT-Desktop-cef ASSET_SUFFIX=linux-x86_64 VERSION_NAME=nightly REQUIRE_UPDATER_SIGNATURE=1
expect_listing "cef names" "QueryMT-Desktop-cef-nightly-linux-x86_64.AppImage QueryMT-Desktop-cef-nightly-linux-x86_64.AppImage.sig QueryMT-Desktop-cef-nightly-linux-x86_64.deb QueryMT-Desktop-cef-nightly-linux-x86_64.tar.gz "

run "unknown runtime fails" fail RUNTIME=bogus TARGET=x ASSET_PREFIX=a ASSET_SUFFIX=b VERSION_NAME=nightly
run "unsupported wry target fails" fail RUNTIME=wry TARGET=x86_64-unknown-freebsd ASSET_PREFIX=a ASSET_SUFFIX=b VERSION_NAME=nightly

if [ "$failures" -gt 0 ]; then
  echo "$failures test(s) failed" >&2
  exit 1
fi
echo "all collect-bundles tests passed"
