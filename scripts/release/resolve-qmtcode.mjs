#!/usr/bin/env node
// Resolve the querymt qmtcode release a desktop build bundles.
//
//   node scripts/release/resolve-qmtcode.mjs <latest|nightly> [options]
//
// Reads the `release.json` published with the querymt release (never asset
// names or notes) and prints JSON:
//
//   { "version", "commit", "channel", "tag", "assets": { "<target>": { "name", "url" } } }
//
// It fails when release.json is missing or inconsistent, or when any expected
// target has no qmtcode asset: a desktop release must bundle the same qmtcode
// version in every artifact.
//
// Options:
//   --repo <owner/name>   querymt repository (default: querymt/querymt)
//   --github-output       also append `version`, `commit` and `assets` (JSON) to $GITHUB_OUTPUT
//
// GITHUB_TOKEN, when set, is used for API and asset requests.

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseSemver } from './lib/semver.mjs';

export const QMTCODE_TARGETS = [
  { target: 'aarch64-apple-darwin', ext: 'tar.gz' },
  { target: 'x86_64-apple-darwin', ext: 'tar.gz' },
  { target: 'x86_64-pc-windows-msvc', ext: 'zip' },
  { target: 'x86_64-unknown-linux-musl', ext: 'tar.gz' },
  { target: 'aarch64-unknown-linux-musl', ext: 'tar.gz' }
];

const CHANNEL_FOR = { latest: 'stable', nightly: 'nightly' };
const COMMIT = /^[0-9a-f]{40}$/;

/**
 * Pure resolution step. `release` is the GitHub release object, `manifest` the
 * parsed release.json (or null/undefined when it is missing).
 */
export function resolveQmtcode({ which, release, manifest, targets = QMTCODE_TARGETS }) {
  const expectedChannel = CHANNEL_FOR[which];
  if (!expectedChannel) throw new Error(`release must be 'latest' or 'nightly', got '${which}'`);
  if (!manifest) {
    throw new Error(
      `${release?.tag_name ?? which} release has no release.json; the desktop build cannot determine the qmtcode version`
    );
  }
  for (const field of ['version', 'channel', 'commit']) {
    if (typeof manifest[field] !== 'string' || manifest[field] === '') {
      throw new Error(`release.json is missing '${field}'`);
    }
  }
  parseSemver(manifest.version);
  if (manifest.channel !== expectedChannel) {
    throw new Error(`release.json channel is '${manifest.channel}', expected '${expectedChannel}'`);
  }
  if (!COMMIT.test(manifest.commit)) {
    throw new Error(`release.json commit '${manifest.commit}' is not a full 40-character SHA`);
  }
  if (which === 'latest' && release.tag_name !== `v${manifest.version}`) {
    throw new Error(`release tag ${release.tag_name} does not match release.json version ${manifest.version}`);
  }

  // Stable asset labels must carry the manifest version; nightly labels are
  // `nightly` or the legacy `nightly-<short sha>` form.
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const label = which === 'latest' ? `v${escape(manifest.version)}` : 'nightly(?:-[0-9a-f]{7,40})?';

  const assets = {};
  const missing = [];
  for (const { target, ext } of targets) {
    const pattern = new RegExp(`^qmtcode-${label}-${escape(target)}\\.${escape(ext)}$`);
    const matches = (release.assets ?? []).filter((asset) => pattern.test(asset.name));
    if (matches.length !== 1) {
      missing.push(`${target} (${matches.length} matches)`);
      continue;
    }
    assets[target] = { name: matches[0].name, url: matches[0].browser_download_url };
  }
  if (missing.length > 0) {
    throw new Error(`${release.tag_name} is missing qmtcode assets for: ${missing.join(', ')}`);
  }

  return {
    version: manifest.version,
    commit: manifest.commit,
    channel: manifest.channel,
    tag: release.tag_name,
    assets
  };
}

/** GETs a URL and returns its JSON body; throws on a non-2xx response. */
async function fetchJson(fetchImpl, url, headers) {
  const response = await fetchImpl(url, { headers, redirect: 'follow' });
  if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);
  return response.json();
}

/** Fetches the querymt release and its release.json, then resolves the bundled qmtcode. */
export async function fetchAndResolve({ which, repo, token, fetchImpl = fetch }) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'querymt-desktop-release' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const path = which === 'latest' ? 'releases/latest' : 'releases/tags/nightly';
  const release = await fetchJson(fetchImpl, `https://api.github.com/repos/${repo}/${path}`, headers);

  const manifestAsset = (release.assets ?? []).find((asset) => asset.name === 'release.json');
  const manifest = manifestAsset
    ? await fetchJson(fetchImpl, manifestAsset.browser_download_url, { ...headers, Accept: 'application/json' })
    : null;

  return resolveQmtcode({ which, release, manifest });
}

/** Parses the command line options. */
function parseArgs(argv) {
  const args = { which: null, repo: 'querymt/querymt', githubOutput: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo') args.repo = argv[++i];
    else if (arg === '--github-output') args.githubOutput = true;
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else if (args.which === null) args.which = arg;
    else throw new Error(`unexpected argument ${arg}`);
  }
  if (args.which === null) throw new Error('usage: resolve-qmtcode.mjs <latest|nightly> [--repo o/n] [--github-output]');
  return args;
}

/** CLI entry: prints the resolved release as JSON and optionally writes GITHUB_OUTPUT. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await fetchAndResolve({ which: args.which, repo: args.repo, token: process.env.GITHUB_TOKEN });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (args.githubOutput) {
    if (!process.env.GITHUB_OUTPUT) throw new Error('--github-output requires GITHUB_OUTPUT');
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${result.version}\ncommit=${result.commit}\nassets=${JSON.stringify(result.assets)}\n`
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`resolve-qmtcode: ${error.message}`);
    process.exit(1);
  });
}
