import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareSemver, parseSemver } from './semver.mjs';

test('rejects numeric prerelease identifiers with leading zeros', () => {
  assert.throws(() => parseSemver('0.6.0-nightly.01'), /semver/);
  assert.throws(() => parseSemver('0.6.0-00'), /semver/);
});

test('accepts valid prerelease identifiers', () => {
  assert.deepEqual(parseSemver('0.6.0-nightly.20261105111147').pre, ['nightly', '20261105111147']);
  assert.deepEqual(parseSemver('1.0.0-0.3.7').pre, ['0', '3', '7']);
  assert.deepEqual(parseSemver('1.0.0-x-1.0a').pre, ['x-1', '0a']);
  assert.equal(compareSemver('0.6.0-nightly.2', '0.6.0'), -1);
});
