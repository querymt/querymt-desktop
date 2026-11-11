#!/usr/bin/env node
// Stable desktop gate: a stable release must not bundle a qmtcode older than
// the one in the currently published desktop nightly feed.
//
//   node scripts/release/check-qmtcode-gate.mjs --bundled <semver> --nightly-feed-url <url> --repo <owner/name>
//
// Users on the nightly are never offered such a stable (the app refuses a
// qmtcode downgrade), but publishing it would still be a release nobody on the
// nightly can reach. The check keeps it from being published at all.
//
// A missing feed (HTTP 404) only passes the gate when the repository has no
// nightly at all (an initial release). The nightly workflow briefly has no
// `nightly` release while it replaces it, and a nightly published without a feed
// cannot be compared either, so both of those fail the gate. Any other failure
// to read the feed fails the gate too.

import { pathToFileURL } from 'node:url';
import { compareSemver, parseSemver } from './lib/semver.mjs';

/**
 * @param {{ bundled: string, nightlyFeed: null | { qmtcode_version?: string } }} input
 * @returns {{ ok: boolean, message: string }}
 */
export function checkQmtcodeGate({ bundled, nightlyFeed }) {
  parseSemver(bundled);
  if (nightlyFeed === null) {
    return { ok: true, message: 'no published desktop nightly feed; nothing to compare against' };
  }
  const nightly = nightlyFeed.qmtcode_version;
  if (typeof nightly !== 'string' || nightly === '') {
    return { ok: false, message: 'the desktop nightly feed has no qmtcode_version' };
  }
  parseSemver(nightly);
  if (compareSemver(bundled, nightly) < 0) {
    return {
      ok: false,
      message: `this release would bundle qmtcode ${bundled}, older than ${nightly} in the published desktop nightly feed. Wait for a querymt stable that contains the nightly's commit, or republish the nightly with an older qmtcode.`
    };
  }
  return { ok: true, message: `bundled qmtcode ${bundled} is not older than the nightly's ${nightly}` };
}

/**
 * Fetches the nightly feed. Returns null on HTTP 404; any other failure throws.
 * @param {string} url
 * @param {typeof fetch} [fetchImpl]
 */
export async function fetchNightlyFeed(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);
  return response.json();
}

/**
 * Establishes whether the repository has any nightly (a published `nightly`
 * release or an in-progress `nightly-staging` draft). Throws on API errors.
 */
export async function nightlyExists({ repo, token, fetchImpl = fetch }) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'querymt-desktop-release' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const api = `https://api.github.com/repos/${repo}/releases`;

  const published = await fetchImpl(`${api}/tags/nightly`, { headers, redirect: 'follow' });
  if (published.ok) return true;
  if (published.status !== 404) throw new Error(`GET ${api}/tags/nightly failed: HTTP ${published.status}`);

  const list = await fetchImpl(`${api}?per_page=100`, { headers, redirect: 'follow' });
  if (!list.ok) throw new Error(`GET ${api} failed: HTTP ${list.status}`);
  const releases = await list.json();
  return releases.some((release) => release.tag_name === 'nightly-staging' || release.tag_name === 'nightly');
}

/**
 * Reads the nightly baseline for the gate. Returns the feed, or null only when
 * no nightly exists at all. A 404 feed while a nightly exists, or while the
 * nightly is being replaced, is retried and then fails closed.
 */
export async function resolveNightlyBaseline({
  feedUrl,
  repo,
  token,
  fetchImpl = fetch,
  attempts = 4,
  delayMs = 15000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const feed = await fetchNightlyFeed(feedUrl, fetchImpl);
    if (feed !== null) return feed;
    if (!(await nightlyExists({ repo, token, fetchImpl }))) return null;
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(
    `${feedUrl} is not available although a desktop nightly exists or is being published; refusing to skip the qmtcode comparison. Retry once the nightly is published, or republish the nightly.`
  );
}

/** CLI entry: compares the bundled qmtcode with the nightly feed and exits non-zero on failure. */
async function main() {
  const args = process.argv.slice(2);
  /** Reads a required `--name value` option. */
  const get = (name) => {
    const i = args.indexOf(`--${name}`);
    if (i < 0 || !args[i + 1]) throw new Error(`missing --${name}`);
    return args[i + 1];
  };
  const result = checkQmtcodeGate({
    bundled: get('bundled'),
    nightlyFeed: await resolveNightlyBaseline({
      feedUrl: get('nightly-feed-url'),
      repo: get('repo'),
      token: process.env.GITHUB_TOKEN
    })
  });
  if (!result.ok) {
    console.error(`::error::qmtcode gate: ${result.message}`);
    process.exit(1);
  }
  console.log(`qmtcode gate: ${result.message}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`check-qmtcode-gate: ${error.message}`);
    process.exit(1);
  });
}
