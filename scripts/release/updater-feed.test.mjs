import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyTauriSignature } from './lib/minisign.mjs';
import { buildFeed, expectedPlatforms } from './updater-feed.mjs';

const SCRIPT = fileURLToPath(new URL('./updater-feed.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

// --- a minimal minisign signer, in the format `tauri signer sign` produces ----

function newKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const keyId = Buffer.from('0102030405060708', 'hex');
  const text = `untrusted comment: minisign public key: test\n${Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64')}\n`;
  return { privateKey: createPrivateKey(privateKey.export({ format: 'pem', type: 'pkcs8' })), keyId, publicKeyBase64: Buffer.from(text).toString('base64') };
}

function signFile(keypair, data) {
  const digest = createHash('blake2b512').update(data).digest();
  const signature = sign(null, digest, keypair.privateKey);
  const trusted = 'timestamp:1\tfile:test';
  const global = sign(null, Buffer.concat([signature, Buffer.from(trusted)]), keypair.privateKey);
  const text =
    `untrusted comment: signature from tauri secret key\n` +
    `${Buffer.concat([Buffer.from('ED'), keyId(keypair), signature]).toString('base64')}\n` +
    `trusted comment: ${trusted}\n${global.toString('base64')}\n`;
  return Buffer.from(Buffer.from(text).toString('base64'));
}
const keyId = (keypair) => keypair.keyId;

const VERSION = '0.1.11-nightly.20261111100000';
const QMTCODE = '0.6.0-nightly.20261111054629';
const BASE_URL = 'https://github.com/querymt/querymt-desktop/releases/download/nightly';

function completeDist(keypair, versionName = 'nightly') {
  const files = new Map();
  for (const name of Object.values(expectedPlatforms(versionName))) {
    const data = Buffer.from(`artifact ${name}`);
    files.set(name, data);
    files.set(`${name}.sig`, signFile(keypair, data));
  }
  // Non-updater assets are ignored.
  files.set(`QueryMT-Desktop-${versionName}-macos-aarch64.dmg`, Buffer.from('dmg'));
  files.set(`QueryMT-Desktop-wry-${versionName}-linux-x86_64.deb`, Buffer.from('deb'));
  return files;
}

const build = (files, keypair, overrides = {}) =>
  buildFeed({
    files,
    versionName: 'nightly',
    version: VERSION,
    qmtcodeVersion: QMTCODE,
    baseUrl: BASE_URL,
    publicKeyBase64: keypair.publicKeyBase64,
    notes: 'notes',
    pubDate: '2026-11-11T10:00:00.000Z',
    ...overrides
  });

test('expects 7 platform keys with runtime-specific linux keys', () => {
  assert.deepEqual(Object.keys(expectedPlatforms('nightly')).sort(), [
    'darwin-aarch64',
    'darwin-x86_64',
    'linux-aarch64-cef',
    'linux-aarch64-wry',
    'linux-x86_64-cef',
    'linux-x86_64-wry',
    'windows-x86_64'
  ]);
});

test('builds a complete feed with verified signatures', () => {
  const keypair = newKeypair();
  const files = completeDist(keypair);
  const feed = build(files, keypair);

  assert.equal(feed.version, VERSION);
  assert.equal(feed.qmtcode_version, QMTCODE);
  assert.equal(feed.notes, 'notes');
  assert.equal(feed.pub_date, '2026-11-11T10:00:00.000Z');
  assert.equal(Object.keys(feed.platforms).length, 7);

  const cef = feed.platforms['linux-aarch64-cef'];
  assert.equal(cef.url, `${BASE_URL}/QueryMT-Desktop-cef-nightly-linux-aarch64.AppImage`);
  assert.equal(cef.signature, files.get('QueryMT-Desktop-cef-nightly-linux-aarch64.AppImage.sig').toString());
  assert.equal(feed.platforms['windows-x86_64'].url, `${BASE_URL}/QueryMT-Desktop-nightly-windows-x64-setup.exe`);
});

test('stable feed uses the vX.Y.Z asset names', () => {
  const keypair = newKeypair();
  const files = completeDist(keypair, 'v0.1.11');
  const feed = build(files, keypair, {
    versionName: 'v0.1.11',
    version: '0.1.11',
    baseUrl: 'https://github.com/querymt/querymt-desktop/releases/download/v0.1.11'
  });
  assert.equal(feed.version, '0.1.11');
  assert.equal(
    feed.platforms['darwin-x86_64'].url,
    'https://github.com/querymt/querymt-desktop/releases/download/v0.1.11/QueryMT-Desktop-v0.1.11-macos-x86_64.app.tar.gz'
  );
});

test('fails on a missing signature and writes no feed', () => {
  const keypair = newKeypair();
  const files = completeDist(keypair);
  files.delete('QueryMT-Desktop-cef-nightly-linux-x86_64.AppImage.sig');
  assert.throws(() => build(files, keypair), /linux-x86_64-cef: signature .* is missing/);
});

test('fails on an empty signature', () => {
  const keypair = newKeypair();
  const files = completeDist(keypair);
  files.set('QueryMT-Desktop-nightly-windows-x64-setup.exe.sig', Buffer.alloc(0));
  assert.throws(() => build(files, keypair), /windows-x86_64: signature .* is missing/);
});

test('fails on a missing platform artifact', () => {
  const keypair = newKeypair();
  const files = completeDist(keypair);
  files.delete('QueryMT-Desktop-wry-nightly-linux-aarch64.AppImage');
  assert.throws(() => build(files, keypair), /linux-aarch64-wry: artifact .* is missing/);
});

test('reports every problem at once', () => {
  const keypair = newKeypair();
  const files = completeDist(keypair);
  files.delete('QueryMT-Desktop-nightly-macos-aarch64.app.tar.gz');
  files.delete('QueryMT-Desktop-nightly-windows-x64-setup.exe.sig');
  try {
    build(files, keypair);
    assert.fail('expected build to throw');
  } catch (error) {
    assert.equal(error.errors.length, 2);
  }
});

test('fails when an artifact was modified after signing', () => {
  const keypair = newKeypair();
  const files = completeDist(keypair);
  files.set('QueryMT-Desktop-nightly-macos-x86_64.app.tar.gz', Buffer.from('tampered'));
  assert.throws(() => build(files, keypair), /darwin-x86_64: .*does not match the artifact/);
});

test('fails when signed by a different key than the updater pubkey', () => {
  const signer = newKeypair();
  const other = newKeypair();
  other.keyId.set(Buffer.from('a1a2a3a4a5a6a7a8', 'hex'));
  // Re-encode `other` with a different key id so the mismatch is reported as such.
  const files = completeDist(signer);
  assert.throws(() => build(files, signer, { publicKeyBase64: other.publicKeyBase64 }), /signed by key|does not match/);
});

test('fails on invalid versions, version names and base URL', () => {
  const keypair = newKeypair();
  const files = completeDist(keypair);
  assert.throws(() => build(files, keypair, { version: 'nightly-abc1234' }), /not a valid semver/);
  assert.throws(() => build(files, keypair, { qmtcodeVersion: '' }), /qmtcode version/);
  assert.throws(() => build(files, keypair, { versionName: 'v9.9.9' }), /version name/);
  assert.throws(() => build(files, keypair, { baseUrl: 'http://example.test' }), /https/);
});

test('verifier accepts a signature produced by the real `tauri signer sign`', () => {
  verifyTauriSignature({
    data: readFileSync(join(FIXTURES, 'artifact.bin')),
    signatureBase64: readFileSync(join(FIXTURES, 'artifact.bin.sig'), 'utf8'),
    publicKeyBase64: readFileSync(join(FIXTURES, 'test-pubkey.txt'), 'utf8')
  });
  assert.throws(() =>
    verifyTauriSignature({
      data: Buffer.from('other bytes'),
      signatureBase64: readFileSync(join(FIXTURES, 'artifact.bin.sig'), 'utf8'),
      publicKeyBase64: readFileSync(join(FIXTURES, 'test-pubkey.txt'), 'utf8')
    })
  );
});

test('CLI writes latest.json for a complete dist and fails on an incomplete one', () => {
  const keypair = newKeypair();
  const dir = mkdtempSync(join(tmpdir(), 'updater-feed-'));
  const dist = join(dir, 'dist');
  mkdirSync(dist);
  for (const [name, data] of completeDist(keypair)) writeFileSync(join(dist, name), data);
  const config = join(dir, 'tauri.conf.json');
  writeFileSync(config, JSON.stringify({ plugins: { updater: { pubkey: keypair.publicKeyBase64 } } }));
  writeFileSync(join(dir, 'notes.md'), 'Commit: abc\n');
  const out = join(dir, 'latest.json');
  const args = [
    SCRIPT, '--dist', dist, '--version-name', 'nightly', '--version', VERSION, '--base-url', BASE_URL,
    '--qmtcode-version', QMTCODE, '--pubkey-from', config, '--out', out, '--notes-file', join(dir, 'notes.md')
  ];

  execFileSync('node', args, { stdio: 'pipe' });
  const feed = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(feed.notes, 'Commit: abc');
  assert.equal(Object.keys(feed.platforms).length, 7);

  writeFileSync(join(dist, 'QueryMT-Desktop-nightly-windows-x64-setup.exe.sig'), '');
  const failing = join(dir, 'failing.json');
  assert.throws(() => execFileSync('node', args.map((a) => (a === out ? failing : a)), { stdio: 'pipe' }));
  assert.throws(() => readFileSync(failing), /ENOENT/);
});
