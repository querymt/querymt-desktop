import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeNightlyVersion, parseTags } from './nightly-version.mjs';
import { compareSemver } from './lib/semver.mjs';

const TS = '20261105111147';
const SCRIPT = fileURLToPath(new URL('./nightly-version.mjs', import.meta.url));

// Shared with querymt's scripts/release/test-release-scripts.sh (task 1.1),
// plus the scenarios of the desktop-release-channels spec.
const cases = [
  ['unreleased workspace version', '0.6.0', ['v0.5.1', 'v0.5.2'], `0.6.0-nightly.${TS}`],
  ['workspace version already tagged -> next patch', '0.6.0', ['v0.5.2', 'v0.6.0'], `0.6.1-nightly.${TS}`],
  ['no tags at all', '0.6.0', [], `0.6.0-nightly.${TS}`],
  ['v0.6.0 is not matched by v0.6.00, v10.6.0 or v0.6.0-rc1', '0.6.0', ['v0.6.00', 'v10.6.0', 'v0.6.0-rc1'], `0.6.0-nightly.${TS}`],
  ['a later tag does not matter, only the project version', '0.6.0', ['v0.7.0'], `0.6.0-nightly.${TS}`],
  ['two-digit patch bump', '0.6.9', ['v0.6.9'], `0.6.10-nightly.${TS}`],
  // desktop-release-channels spec scenarios
  ['spec: project version already released', '0.1.7', ['v0.1.7'], `0.1.8-nightly.${TS}`],
  ['spec: project version not yet released', '0.1.8', ['v0.1.7'], `0.1.8-nightly.${TS}`]
];

for (const [name, version, tags, expected] of cases) {
  test(`computeNightlyVersion: ${name}`, () => {
    assert.equal(computeNightlyVersion({ version, tags: new Set(tags), timestamp: TS }), expected);
  });
}

test('spec: nightly built 2026-11-06 14:32:00 UTC', () => {
  assert.equal(
    computeNightlyVersion({ version: '0.1.7', tags: new Set(['v0.1.7']), timestamp: '20261106143200' }),
    '0.1.8-nightly.20261106143200'
  );
});

test('spec: later nightly from the same base sorts higher', () => {
  const tags = new Set(['v0.1.7']);
  const earlier = computeNightlyVersion({ version: '0.1.7', tags, timestamp: '20261106143200' });
  const later = computeNightlyVersion({ version: '0.1.7', tags, timestamp: '20261106143201' });
  assert.equal(compareSemver(later, earlier), 1);
  // 14-digit timestamps are single numeric identifiers: compared numerically, not by length.
  assert.equal(compareSemver('0.1.8-nightly.20261106143200', '0.1.8-nightly.20261106143200'), 0);
});

test('nightly sorts between the stables around it', () => {
  const nightly = `0.6.0-nightly.${TS}`;
  assert.equal(compareSemver(nightly, '0.5.2'), 1);
  assert.equal(compareSemver(nightly, '0.6.0'), -1);
  const afterRelease = computeNightlyVersion({ version: '0.6.0', tags: new Set(['v0.6.0']), timestamp: TS });
  assert.equal(compareSemver(afterRelease, '0.6.0'), 1);
  assert.equal(compareSemver(afterRelease, '0.6.1'), -1);
});

test('rejects invalid project versions and timestamps', () => {
  assert.throws(() => computeNightlyVersion({ version: '0.6', tags: new Set(), timestamp: TS }), /X\.Y\.Z/);
  assert.throws(() => computeNightlyVersion({ version: '0.6.0-rc.1', tags: new Set(), timestamp: TS }), /X\.Y\.Z/);
  assert.throws(() => computeNightlyVersion({ version: '0.6.0', tags: new Set(), timestamp: '2026' }), /YYYYMMDDHHMMSS/);
});

test('parseTags accepts names, refs and git ls-remote output with peeled tags', () => {
  const tags = parseTags(
    ['aaaa\trefs/tags/v0.6.0', 'bbbb\trefs/tags/v0.6.0^{}', 'v0.5.2', 'refs/tags/v0.5.1', ''].join('\n')
  );
  assert.deepEqual([...tags].sort(), ['v0.5.1', 'v0.5.2', 'v0.6.0']);
  assert.equal(computeNightlyVersion({ version: '0.6.0', tags, timestamp: TS }), `0.6.1-nightly.${TS}`);
});

test('CLI reads package.json and a tags file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nightly-version-'));
  const pkg = join(dir, 'package.json');
  const tags = join(dir, 'tags.txt');
  writeFileSync(pkg, JSON.stringify({ name: 'x', version: '0.1.7' }));
  writeFileSync(tags, 'aaaa\trefs/tags/v0.1.7\nbbbb\trefs/tags/v0.1.7^{}\n');
  const out = execFileSync('node', [SCRIPT, '20261106143200', '--package', pkg, '--tags-file', tags], {
    encoding: 'utf8'
  });
  assert.equal(out, '0.1.8-nightly.20261106143200\n');
});

test('CLI fails on a bad timestamp', () => {
  assert.throws(() => execFileSync('node', [SCRIPT, 'nope', '--tags-file', '/dev/null'], { stdio: 'pipe' }));
});
