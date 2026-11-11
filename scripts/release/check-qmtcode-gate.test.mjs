import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkQmtcodeGate, fetchNightlyFeed } from './check-qmtcode-gate.mjs';

const feed = (qmtcode_version) => ({ version: '0.1.11-nightly.20261111100000', qmtcode_version });

test('spec: stable bundling older qmtcode than the nightly feed fails', () => {
  const result = checkQmtcodeGate({ bundled: '0.5.2', nightlyFeed: feed('0.6.0-nightly.20261105111147') });
  assert.equal(result.ok, false);
  assert.match(result.message, /0\.5\.2.*0\.6\.0-nightly\.20261105111147/);
});

test('passes when the stable qmtcode is newer than the nightly one', () => {
  assert.equal(checkQmtcodeGate({ bundled: '0.6.0', nightlyFeed: feed('0.6.0-nightly.20261105111147') }).ok, true);
  assert.equal(checkQmtcodeGate({ bundled: '0.6.1', nightlyFeed: feed('0.6.1-nightly.20261105111147') }).ok, true);
});

test('passes when equal', () => {
  assert.equal(checkQmtcodeGate({ bundled: '0.6.0', nightlyFeed: feed('0.6.0') }).ok, true);
});

test('a forced lower qmtcode version fails', () => {
  assert.equal(checkQmtcodeGate({ bundled: '0.6.0', nightlyFeed: feed('0.6.1-nightly.20261105111147') }).ok, false);
});

test('passes when there is no nightly feed yet', () => {
  assert.equal(checkQmtcodeGate({ bundled: '0.5.2', nightlyFeed: null }).ok, true);
});

test('fails when the feed has no qmtcode_version', () => {
  assert.equal(checkQmtcodeGate({ bundled: '0.6.0', nightlyFeed: { version: '1.0.0' } }).ok, false);
});

test('rejects a non-semver bundled version', () => {
  assert.throws(() => checkQmtcodeGate({ bundled: 'nightly-abc', nightlyFeed: null }), /semver/);
});

test('fetchNightlyFeed: 404 means no feed, other errors fail', async () => {
  assert.equal(await fetchNightlyFeed('https://x.test/latest.json', async () => ({ ok: false, status: 404 })), null);
  await assert.rejects(fetchNightlyFeed('https://x.test/latest.json', async () => ({ ok: false, status: 500 })), /HTTP 500/);
  assert.deepEqual(
    await fetchNightlyFeed('https://x.test/latest.json', async () => ({ ok: true, status: 200, json: async () => feed('1.0.0') })),
    feed('1.0.0')
  );
});
