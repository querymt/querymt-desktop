import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { fetchAndResolve, QMTCODE_TARGETS, resolveQmtcode } from './resolve-qmtcode.mjs';

const SHA = 'fa1b0c81a1050dfba8a0736052acffd7d094c7e9';

const sha256 = (data) => `sha256:${createHash('sha256').update(data).digest('hex')}`;
let nextId = 1000;
/** An asset the way the GitHub API returns it: id, API url and digest included. */
const asset = (name, browser_download_url, content = name) => {
  const id = nextId++;
  return { id, name, browser_download_url, url: `https://api.github.com/repos/querymt/querymt/releases/assets/${id}`, digest: sha256(content) };
};

function releaseFixture(label, { tag = 'nightly', withManifest = true, drop = [], manifest = null } = {}) {
  const assets = [];
  for (const { target, ext } of QMTCODE_TARGETS) {
    if (drop.includes(target)) continue;
    const name = `qmtcode-${label}-${target}.${ext}`;
    assets.push(asset(name, `https://example.test/${tag}/${name}`));
    // qmt (not qmtcode) assets and the freebsd/arm windows builds must be ignored.
    assets.push(asset(`qmt-${label}-${target}.${ext}`, 'https://example.test/qmt'));
  }
  assets.push(asset(`qmtcode-${label}-x86_64-unknown-freebsd.tar.gz`, 'https://example.test/bsd'));
  assets.push(asset(`qmtcode-${label}-aarch64-pc-windows-msvc.zip`, 'https://example.test/winarm'));
  if (withManifest) {
    assets.push(asset('release.json', `https://example.test/${tag}/release.json`, JSON.stringify(manifest ?? nightlyManifest)));
  }
  return { tag_name: tag, assets };
}

const nightlyManifest = { version: '0.6.0-nightly.20261111054629', channel: 'nightly', commit: SHA, published_at: '2026-11-11T06:34:32Z' };
const stableManifest = { version: '0.6.0', channel: 'stable', commit: SHA, published_at: '2026-11-20T10:00:00Z' };

test('resolves the nightly version, commit and per-target asset URLs', () => {
  const result = resolveQmtcode({
    which: 'nightly',
    release: releaseFixture('nightly'),
    manifest: nightlyManifest
  });
  assert.equal(result.version, '0.6.0-nightly.20261111054629');
  assert.equal(result.commit, SHA);
  assert.equal(result.channel, 'nightly');
  assert.deepEqual(Object.keys(result.assets).sort(), QMTCODE_TARGETS.map((t) => t.target).sort());
  assert.equal(
    result.assets['aarch64-apple-darwin'].url,
    'https://example.test/nightly/qmtcode-nightly-aarch64-apple-darwin.tar.gz'
  );
  assert.equal(result.assets['x86_64-pc-windows-msvc'].name, 'qmtcode-nightly-x86_64-pc-windows-msvc.zip');
});

test('resolves the latest stable release', () => {
  const result = resolveQmtcode({
    which: 'latest',
    release: releaseFixture('v0.6.0', { tag: 'v0.6.0' }),
    manifest: stableManifest
  });
  assert.equal(result.version, '0.6.0');
  assert.equal(result.assets['x86_64-unknown-linux-musl'].name, 'qmtcode-v0.6.0-x86_64-unknown-linux-musl.tar.gz');
});

test('also resolves legacy asset names containing a SHA', () => {
  const result = resolveQmtcode({
    which: 'nightly',
    release: releaseFixture('nightly-d530f82'),
    manifest: nightlyManifest
  });
  assert.equal(result.assets['aarch64-apple-darwin'].name, 'qmtcode-nightly-d530f82-aarch64-apple-darwin.tar.gz');
});

test('fails when release.json is missing', () => {
  assert.throws(
    () => resolveQmtcode({ which: 'nightly', release: releaseFixture('nightly', { withManifest: false }), manifest: null }),
    /no release\.json/
  );
});

test('fails when a target asset is missing', () => {
  assert.throws(
    () =>
      resolveQmtcode({
        which: 'nightly',
        release: releaseFixture('nightly', { drop: ['x86_64-pc-windows-msvc'] }),
        manifest: nightlyManifest
      }),
    /x86_64-pc-windows-msvc/
  );
});

test('fails on an ambiguous asset match', () => {
  const release = releaseFixture('nightly');
  release.assets.push({
    name: 'qmtcode-nightly-d530f82-aarch64-apple-darwin.tar.gz',
    browser_download_url: 'https://example.test/dup'
  });
  assert.throws(() => resolveQmtcode({ which: 'nightly', release, manifest: nightlyManifest }), /aarch64-apple-darwin/);
});

test('ignores stable assets whose label is not the manifest version', () => {
  const release = releaseFixture('v0.6.0', { tag: 'v0.6.0' });
  release.assets.push({
    name: 'qmtcode-v0.5.2-aarch64-apple-darwin.tar.gz',
    browser_download_url: 'https://example.test/stale'
  });
  const result = resolveQmtcode({ which: 'latest', release, manifest: stableManifest });
  assert.equal(result.assets['aarch64-apple-darwin'].name, 'qmtcode-v0.6.0-aarch64-apple-darwin.tar.gz');
  assert.throws(
    () => resolveQmtcode({ which: 'latest', release: releaseFixture('v0.5.2', { tag: 'v0.6.0' }), manifest: stableManifest }),
    /missing usable qmtcode assets/
  );
});

test('fails on inconsistent manifests', () => {
  const release = releaseFixture('nightly');
  const resolve = (manifest, which = 'nightly', rel = release) => resolveQmtcode({ which, release: rel, manifest });
  assert.throws(() => resolve({ ...nightlyManifest, channel: 'stable' }), /channel/);
  assert.throws(() => resolve({ ...nightlyManifest, commit: 'abc' }), /40-character/);
  assert.throws(() => resolve({ ...nightlyManifest, version: 'nightly-d530f82' }), /semver/);
  assert.throws(() => resolve({ channel: 'nightly', commit: SHA }), /version/);
  assert.throws(
    () => resolve(stableManifest, 'latest', releaseFixture('v0.5.2', { tag: 'v0.5.2' })),
    /does not match/
  );
  assert.throws(() => resolve(nightlyManifest, 'beta'), /latest.*nightly/);
});

/** Serves the release API and asset downloads; `tamper` replaces the release.json bytes. */
function fakeFetch(release, manifestBytes, requested = []) {
  return async (url, options = {}) => {
    requested.push({ url, accept: options.headers?.Accept });
    if (url.endsWith('/releases/tags/nightly') || url.endsWith('/releases/latest')) {
      return { ok: true, status: 200, json: async () => release };
    }
    const manifestAsset = release.assets.find((a) => a.name === 'release.json');
    if (manifestAsset && url === manifestAsset.url) {
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(manifestBytes).buffer };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test('records asset id, API url and digest for every target', () => {
  const release = releaseFixture('nightly');
  const result = resolveQmtcode({ which: 'nightly', release, manifest: nightlyManifest });
  for (const { target, ext } of QMTCODE_TARGETS) {
    const source = release.assets.find((a) => a.name === `qmtcode-nightly-${target}.${ext}`);
    assert.deepEqual(result.assets[target], {
      name: source.name,
      id: source.id,
      url: source.browser_download_url,
      api_url: source.url,
      digest: source.digest
    });
  }
});

test('fails when a matching asset has no usable sha256 digest or id', () => {
  const noDigest = releaseFixture('nightly');
  delete noDigest.assets.find((a) => a.name === 'qmtcode-nightly-aarch64-apple-darwin.tar.gz').digest;
  assert.throws(() => resolveQmtcode({ which: 'nightly', release: noDigest, manifest: nightlyManifest }), /no sha256 digest/);

  const badDigest = releaseFixture('nightly');
  badDigest.assets.find((a) => a.name === 'qmtcode-nightly-aarch64-apple-darwin.tar.gz').digest = 'sha1:abc';
  assert.throws(() => resolveQmtcode({ which: 'nightly', release: badDigest, manifest: nightlyManifest }), /no sha256 digest/);

  const noId = releaseFixture('nightly');
  delete noId.assets.find((a) => a.name === 'qmtcode-nightly-aarch64-apple-darwin.tar.gz').id;
  assert.throws(() => resolveQmtcode({ which: 'nightly', release: noId, manifest: nightlyManifest }), /no asset id/);
});

test('fetchAndResolve downloads release.json by asset id and verifies its digest', async () => {
  const requested = [];
  const release = releaseFixture('nightly');
  const bytes = Buffer.from(JSON.stringify(nightlyManifest));
  const result = await fetchAndResolve({ which: 'nightly', repo: 'querymt/querymt', fetchImpl: fakeFetch(release, bytes, requested) });
  assert.equal(result.version, nightlyManifest.version);
  const manifestAsset = release.assets.find((a) => a.name === 'release.json');
  assert.deepEqual(requested.map((r) => r.url), [
    'https://api.github.com/repos/querymt/querymt/releases/tags/nightly',
    manifestAsset.url
  ]);
  assert.equal(requested[1].accept, 'application/octet-stream');
});

test('fetchAndResolve rejects a release.json that does not match its recorded digest', async () => {
  const release = releaseFixture('nightly');
  const replaced = Buffer.from(JSON.stringify({ ...nightlyManifest, version: '0.6.0-nightly.20261112000000' }));
  await assert.rejects(
    fetchAndResolve({ which: 'nightly', repo: 'querymt/querymt', fetchImpl: fakeFetch(release, replaced) }),
    /does not match its recorded digest/
  );
});

test('fetchAndResolve fails when the release has no release.json asset', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => releaseFixture('nightly', { withManifest: false }) });
  await assert.rejects(fetchAndResolve({ which: 'nightly', repo: 'querymt/querymt', fetchImpl }), /no release\.json/);
});

test('fetchAndResolve fails on HTTP errors', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(fetchAndResolve({ which: 'latest', repo: 'querymt/querymt', fetchImpl }), /HTTP 404/);
});
