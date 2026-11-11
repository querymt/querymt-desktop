#!/usr/bin/env node
// Stable desktop gate: a stable release must not bundle a qmtcode older than
// the one in the currently published desktop nightly feed.
//
//   node scripts/release/check-qmtcode-gate.mjs --bundled <semver> --nightly-feed-url <url>
//
// Users on the nightly are never offered such a stable (the app refuses a
// qmtcode downgrade), but publishing it would still be a release nobody on the
// nightly can reach. The check keeps it from being published at all.
//
// When no nightly feed exists (HTTP 404: no updater-enabled nightly has been
// published yet) there is nothing to compare against and the gate passes. Any
// other failure to read the feed fails the gate.

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

export async function fetchNightlyFeed(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const args = process.argv.slice(2);
  const get = (name) => {
    const i = args.indexOf(`--${name}`);
    if (i < 0 || !args[i + 1]) throw new Error(`missing --${name}`);
    return args[i + 1];
  };
  const result = checkQmtcodeGate({
    bundled: get('bundled'),
    nightlyFeed: await fetchNightlyFeed(get('nightly-feed-url'))
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
