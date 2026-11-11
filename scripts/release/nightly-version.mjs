#!/usr/bin/env node
// Compute the version of a desktop nightly build (design D2).
//
//   node scripts/release/nightly-version.mjs <UTC YYYYMMDDHHMMSS> [options]
//
// Output: <base>-nightly.<timestamp>
//
// <base> is the version in package.json, unless the stable tag v<version>
// already exists, in which case it is the next patch version. A nightly then
// sorts above the stable it follows and below the next stable.
//
// Options:
//   --package <file>   package.json to read the version from (default: package.json)
//   --remote <name>    git remote to list tags from (default: origin)
//   --tags-file <file> read tags from a file (plain names, refs or `git ls-remote
//                      --tags` output) instead of calling git; `-` reads stdin
//
// querymt's scripts/release/nightly-version.sh implements the same algorithm;
// both are tested against the same table of cases.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const STABLE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const TIMESTAMP = /^\d{14}$/;

/** Normalizes tag names, refs and `git ls-remote --tags` lines into a Set of tag names. */
export function parseTags(text) {
  const tags = new Set();
  for (const line of text.split('\n')) {
    const last = line.trim().split(/\s+/).at(-1);
    if (!last) continue;
    tags.add(last.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, ''));
  }
  return tags;
}

/** Computes `<base>-nightly.<timestamp>`, bumping the patch when `v<base>` is already tagged. */
export function computeNightlyVersion({ version, tags, timestamp }) {
  const match = STABLE_VERSION.exec(version);
  if (!match) throw new Error(`project version '${version}' is not X.Y.Z`);
  if (!TIMESTAMP.test(timestamp)) {
    throw new Error(`timestamp '${timestamp}' is not YYYYMMDDHHMMSS`);
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  const tagSet = tags instanceof Set ? tags : new Set(tags);
  const nextPatch = tagSet.has(`v${version}`) ? patch + 1 : patch;
  return `${major}.${minor}.${nextPatch}-nightly.${timestamp}`;
}

/** Parses the command line options. */
function parseArgs(argv) {
  const args = { package: 'package.json', remote: 'origin', tagsFile: null, timestamp: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--package') args.package = argv[++i];
    else if (arg === '--remote') args.remote = argv[++i];
    else if (arg === '--tags-file') args.tagsFile = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else if (args.timestamp === null) args.timestamp = arg;
    else throw new Error(`unexpected argument ${arg}`);
  }
  if (args.timestamp === null) {
    throw new Error('usage: nightly-version.mjs <UTC YYYYMMDDHHMMSS> [--package f] [--remote r] [--tags-file f]');
  }
  return args;
}

/** Reads the existing release tags from the arguments or `git ls-remote`. */
function readTags(args) {
  if (args.tagsFile) return readFileSync(args.tagsFile === '-' ? 0 : args.tagsFile, 'utf8');
  return execFileSync('git', ['ls-remote', '--tags', args.remote], { encoding: 'utf8' });
}

/** CLI entry: prints the nightly version. */
function main() {
  const args = parseArgs(process.argv.slice(2));
  const { version } = JSON.parse(readFileSync(args.package, 'utf8'));
  const tags = parseTags(readTags(args));
  process.stdout.write(`${computeNightlyVersion({ version, tags, timestamp: args.timestamp })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`nightly-version: ${error.message}`);
    process.exit(1);
  }
}
