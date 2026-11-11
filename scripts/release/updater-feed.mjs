#!/usr/bin/env node
// Build the updater feed (latest.json) for one release channel (design D4).
//
//   node scripts/release/updater-feed.mjs \
//     --dist dist --version-name <vX.Y.Z|nightly> --version <semver> \
//     --base-url <download url prefix> --qmtcode-version <semver> \
//     --pubkey-from src-tauri/tauri.conf.json --out dist/latest.json \
//     [--notes-file notes.md] [--pub-date <RFC 3339>] [--verify-pubkey <base64>]
//
// Signatures are verified against the key in --pubkey-from (the key the build
// embeds). During a key rotation the transition release embeds the NEW key but
// is still signed with the OLD one; pass the old key as --verify-pubkey so the
// feed is checked against the key that signed the artifacts, which is also the
// key the already-installed apps trust.
//
// The feed lists, per platform key, the artifact URL and the signature (the
// content of the artifact's .sig file). The script fails, and writes nothing,
// when any expected platform key has no artifact, no signature, or a signature
// that does not verify against the updater public key. A feed is therefore
// never published incomplete or with signatures the installed apps would
// reject.
//
// Platform keys and artifact names (names come from collect-bundles.sh):
//   darwin-aarch64     QueryMT-Desktop-<vn>-macos-aarch64.app.tar.gz
//   darwin-x86_64      QueryMT-Desktop-<vn>-macos-x86_64.app.tar.gz
//   windows-x86_64     QueryMT-Desktop-<vn>-windows-x64-setup.exe
//   linux-<arch>-wry   QueryMT-Desktop-wry-<vn>-linux-<arch>.AppImage
//   linux-<arch>-cef   QueryMT-Desktop-cef-<vn>-linux-<arch>.AppImage

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareSemver, parseSemver } from './lib/semver.mjs';
import { parsePublicKey, verifyTauriSignature } from './lib/minisign.mjs';

/** Expected platform key -> artifact file name for a release. */
export function expectedPlatforms(versionName) {
  const vn = versionName;
  const platforms = {
    'darwin-aarch64': `QueryMT-Desktop-${vn}-macos-aarch64.app.tar.gz`,
    'darwin-x86_64': `QueryMT-Desktop-${vn}-macos-x86_64.app.tar.gz`,
    'windows-x86_64': `QueryMT-Desktop-${vn}-windows-x64-setup.exe`
  };
  for (const arch of ['x86_64', 'aarch64']) {
    platforms[`linux-${arch}-wry`] = `QueryMT-Desktop-wry-${vn}-linux-${arch}.AppImage`;
    platforms[`linux-${arch}-cef`] = `QueryMT-Desktop-cef-${vn}-linux-${arch}.AppImage`;
  }
  return platforms;
}

/**
 * The app version a signature is bound to must be the announced version: otherwise a
 * tampered feed could pair a new version number with an older, validly signed
 * artifact. Missing versions are rejected too, because the updater is configured with
 * `requireSignedVersion` and would refuse such an update anyway.
 */
export function assertSignedVersion(signed, announced) {
  if (!signed) {
    throw new Error(
      'signature carries no app version (sign with `tauri build` or `tauri signer sign --app-version`)'
    );
  }
  const normalize = (value) => value.replace(/^v/, '');
  let same;
  try {
    same = compareSemver(normalize(signed), normalize(announced)) === 0;
  } catch {
    same = signed === announced;
  }
  if (!same) throw new Error(`signature is bound to version ${signed}, not the announced ${announced}`);
}

/**
 * Pure feed construction.
 *
 * @param {object} options
 * @param {Map<string, Buffer>|Record<string, Buffer>} options.files  file name -> content for everything in dist/
 * @param {string} options.versionName  `vX.Y.Z` or `nightly`
 * @param {string} options.version      desktop semver (without `v`)
 * @param {string} options.qmtcodeVersion
 * @param {string} options.baseUrl
 * @param {string} options.publicKeyBase64
 * @param {string} [options.notes]
 * @param {string} [options.pubDate]
 */
export function buildFeed({ files, versionName, version, qmtcodeVersion, baseUrl, publicKeyBase64, notes = '', pubDate }) {
  const errors = [];
  const fileMap = files instanceof Map ? files : new Map(Object.entries(files));

  for (const [label, value] of [['version', version], ['qmtcode version', qmtcodeVersion]]) {
    try {
      parseSemver(value);
    } catch {
      errors.push(`${label} '${value}' is not a valid semver version`);
    }
  }
  if (versionName !== 'nightly' && versionName !== `v${version}`) {
    errors.push(`version name '${versionName}' must be 'nightly' or 'v${version}'`);
  }
  if (!/^https:\/\//.test(baseUrl ?? '')) errors.push(`base URL '${baseUrl}' must be an https URL`);

  const platforms = {};
  for (const [key, name] of Object.entries(expectedPlatforms(versionName))) {
    const artifact = fileMap.get(name);
    const signature = fileMap.get(`${name}.sig`);
    if (!artifact) {
      errors.push(`${key}: artifact ${name} is missing`);
      continue;
    }
    if (!signature || signature.length === 0) {
      errors.push(`${key}: signature ${name}.sig is missing`);
      continue;
    }
    const signatureBase64 = signature.toString('utf8').trim();
    try {
      const { signedVersion } = verifyTauriSignature({ data: artifact, signatureBase64, publicKeyBase64 });
      assertSignedVersion(signedVersion, version);
    } catch (error) {
      errors.push(`${key}: ${name}: ${error.message}`);
      continue;
    }
    platforms[key] = { signature: signatureBase64, url: `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(name)}` };
  }

  if (errors.length > 0) {
    const failure = new Error(`updater feed is incomplete:\n  - ${errors.join('\n  - ')}`);
    failure.errors = errors;
    throw failure;
  }

  return {
    version,
    notes,
    pub_date: pubDate ?? new Date().toISOString(),
    qmtcode_version: qmtcodeVersion,
    platforms
  };
}

/** Parses the command line into a name -> value map; every option needs a value. */
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    args[arg.slice(2)] = value;
  }
  for (const required of ['dist', 'version-name', 'version', 'base-url', 'qmtcode-version', 'pubkey-from', 'out']) {
    if (!args[required]) throw new Error(`missing --${required}`);
  }
  return args;
}

/** CLI entry: reads `dist/`, builds the feed and writes it to `--out`. */
function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = new Map();
  for (const name of readdirSync(args.dist)) files.set(name, readFileSync(join(args.dist, name)));

  const publicKeyBase64 = JSON.parse(readFileSync(args['pubkey-from'], 'utf8'))?.plugins?.updater?.pubkey;
  if (!publicKeyBase64) throw new Error(`${args['pubkey-from']} has no plugins.updater.pubkey`);

  // The key signatures are checked against: the key that signed the artifacts, which
  // differs from the embedded key only on the release that rotates it.
  const verifyKey = args['verify-pubkey']?.trim();
  if (verifyKey) parsePublicKey(verifyKey);

  const feed = buildFeed({
    files,
    versionName: args['version-name'],
    version: args.version,
    qmtcodeVersion: args['qmtcode-version'],
    baseUrl: args['base-url'],
    publicKeyBase64: verifyKey || publicKeyBase64,
    notes: args['notes-file'] ? readFileSync(args['notes-file'], 'utf8').trim() : '',
    pubDate: args['pub-date']
  });
  writeFileSync(args.out, `${JSON.stringify(feed, null, 2)}\n`);
  console.log(`Wrote ${args.out}: version ${feed.version}, qmtcode ${feed.qmtcode_version}, ${Object.keys(feed.platforms).length} platforms`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`updater-feed: ${error.message}`);
    process.exit(1);
  }
}
