import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkQmtcodeGate, fetchNightlyFeed, resolveNightlyBaseline } from './check-qmtcode-gate.mjs';

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

const route = (routes) => async (url) => {
  const hit = Object.entries(routes).find(([suffix]) => url.endsWith(suffix));
  const body = hit ? hit[1] : { status: 404 };
  return { ok: body.status === undefined || body.status < 400, status: body.status ?? 200, json: async () => body.json ?? body };
};
const baseline = (routes, extra = {}) =>
  resolveNightlyBaseline({
    feedUrl: 'https://x.test/latest.json',
    repo: 'o/r',
    fetchImpl: route(routes),
    sleep: async () => {},
    delayMs: 0,
    ...extra
  });

test('baseline: a feed is returned as is', async () => {
  assert.deepEqual(await baseline({ '/latest.json': feed('1.0.0') }), feed('1.0.0'));
});

test('baseline: no feed and no nightly at all passes as an initial release', async () => {
  assert.equal(await baseline({ '/releases?per_page=100': { json: [{ tag_name: 'v0.1.0' }] } }), null);
});

test('baseline: no feed but a published nightly fails closed', async () => {
  await assert.rejects(baseline({ '/releases/tags/nightly': { json: { tag_name: 'nightly' } } }), /refusing to skip/);
});

test('baseline: a nightly being replaced fails closed', async () => {
  await assert.rejects(
    baseline({ '/releases?per_page=100': { json: [{ tag_name: 'nightly-staging' }] } }),
    /refusing to skip/
  );
});

test('baseline: a replacement gap that closes within the retries uses the new feed', async () => {
  let feedCalls = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/latest.json')) {
      feedCalls += 1;
      return feedCalls < 2
        ? { ok: false, status: 404 }
        : { ok: true, status: 200, json: async () => feed('1.0.0') };
    }
    return { ok: true, status: 200, json: async () => ({ tag_name: 'nightly' }) };
  };
  assert.deepEqual(await baseline({}, { fetchImpl }), feed('1.0.0'));
});

test('baseline: API errors fail', async () => {
  await assert.rejects(baseline({ '/releases/tags/nightly': { status: 500 } }), /HTTP 500/);
});
