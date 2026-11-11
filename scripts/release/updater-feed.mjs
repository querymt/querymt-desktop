#!/usr/bin/env node
// Build the updater feed (latest.json) for one release channel (design D4).
//
//   node scripts/release/updater-feed.mjs \
//     --dist dist --version-name <vX.Y.Z|nightly> --version <semver> \
//     --base-url <download url prefix> --qmtcode-version <semver> \
//     --pubkey-from src-tauri/tauri.conf.json --out dist/latest.json \
//     --manifest-signature manifest.json.sig \
//     [--notes-file notes.md] [--pub-date <RFC 3339>] [--verify-pubkey <base64>]
//
//   node scripts/release/updater-feed.mjs --write-manifest manifest.json \
//     --dist dist --version-name <vX.Y.Z|nightly> \
//     --version <semver> --qmtcode-version <semver>
//
// The feed also carries a signed release manifest (design D12): the exact bytes of
// `{type, version, qmtcode_version, signatures}`, base64 encoded, plus a signature made
// with the updater key (`tauri signer sign --app-version <version> manifest.json`).
// `signatures` maps every platform key to the signature of its artifact, so the app can
// tell that the artifact offered for its target is the one this release built for it.
// Apps read the qmtcode version and the per-target signatures only from there, because
// the rest of the feed is untrusted. `--write-manifest` writes those bytes; sign them,
// then pass the .sig as --manifest-signature. The signature is verified before the feed
// is written.
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

/** `type` of the signed release manifest; the app refuses any other value. */
export const MANIFEST_TYPE = 'querymt-desktop-release-manifest/v1';

/**
 * Platform key -> trimmed content of the artifact's .sig, for every platform whose
 * signature is present, in the fixed `expectedPlatforms` order.
 */
export function collectSignatures(files, versionName) {
  const fileMap = files instanceof Map ? files : new Map(Object.entries(files));
  const signatures = {};
  for (const [key, name] of Object.entries(expectedPlatforms(versionName))) {
    const signature = fileMap.get(`${name}.sig`)?.toString('utf8').trim();
    if (signature) signatures[key] = signature;
  }
  return signatures;
}

/**
 * The exact bytes that are signed. Deterministic, so the feed step can rebuild them
 * instead of trusting a file that was passed around between steps. `signatures` binds
 * each target to its artifact (design D12).
 */
export function buildManifestPayload({ version, qmtcodeVersion, signatures }) {
  for (const [label, value] of [['version', version], ['qmtcode version', qmtcodeVersion]]) {
    try {
      parseSemver(value);
    } catch {
      throw new Error(`${label} '${value}' is not a valid semver version`);
    }
  }
  if (!signatures || Object.keys(signatures).length === 0) {
    throw new Error('no artifact signatures to bind into the manifest');
  }
  return Buffer.from(JSON.stringify({ type: MANIFEST_TYPE, version, qmtcode_version: qmtcodeVersion, signatures }));
}

/**
 * Pure feed construction.
 *
 * `manifestSignature` is the base64 content of the `.sig` for `buildManifestPayload`.
 * It must verify against `publicKeyBase64` and be bound to `version`.
 *
 * @param {object} options
 * @param {Map<string, Buffer>|Record<string, Buffer>} options.files  file name -> content for everything in dist/
 * @param {string} options.versionName  `vX.Y.Z` or `nightly`
 * @param {string} options.version      desktop semver (without `v`)
 * @param {string} options.qmtcodeVersion
 * @param {string} options.manifestSignature
 * @param {string} options.baseUrl
 * @param {string} options.publicKeyBase64
 * @param {string} [options.notes]
 * @param {string} [options.pubDate]
 */
export function buildFeed({ files, versionName, version, qmtcodeVersion, manifestSignature, baseUrl, publicKeyBase64, notes = '', pubDate }) {
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

  // The channel is not signed separately: it follows from the signed version, which the
  // app checks against the selected channel.
  const isNightlyVersion = /-nightly\./.test(version ?? '');
  if ((versionName === 'nightly') !== isNightlyVersion) {
    errors.push(`version '${version}' does not belong to release '${versionName}'`);
  }

  let manifest = null;
  try {
    manifest = buildManifestPayload({ version, qmtcodeVersion, signatures: collectSignatures(fileMap, versionName) });
    if (!manifestSignature?.trim()) throw new Error('release manifest signature is missing');
    const { signedVersion } = verifyTauriSignature({
      data: manifest,
      signatureBase64: manifestSignature.trim(),
      publicKeyBase64
    });
    assertSignedVersion(signedVersion, version);
  } catch (error) {
    manifest = null;
    errors.push(`release manifest: ${error.message}`);
  }

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
    release_manifest: manifest.toString('base64'),
    release_manifest_signature: manifestSignature.trim(),
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
  const required = args['write-manifest']
    ? ['dist', 'version-name', 'version', 'qmtcode-version']
    : ['dist', 'version-name', 'version', 'base-url', 'qmtcode-version', 'manifest-signature', 'pubkey-from', 'out'];
  for (const name of required) {
    if (!args[name]) throw new Error(`missing --${name}`);
  }
  return args;
}

/** CLI entry: reads `dist/`, builds the feed and writes it to `--out`. */
function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = new Map();
  for (const name of readdirSync(args.dist)) files.set(name, readFileSync(join(args.dist, name)));
  if (args['write-manifest']) {
    const signatures = collectSignatures(files, args['version-name']);
    const missing = Object.keys(expectedPlatforms(args['version-name'])).filter((key) => !signatures[key]);
    if (missing.length > 0) throw new Error(`no artifact signature for: ${missing.join(', ')}`);
    writeFileSync(
      args['write-manifest'],
      buildManifestPayload({ version: args.version, qmtcodeVersion: args['qmtcode-version'], signatures })
    );
    console.log(`Wrote ${args['write-manifest']}: sign it with \`tauri signer sign --app-version ${args.version}\``);
    return;
  }

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
    manifestSignature: readFileSync(args['manifest-signature'], 'utf8'),
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
