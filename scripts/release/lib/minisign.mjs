// Verification of Tauri updater signatures (minisign, as produced by
// `tauri signer sign`), used by updater-feed.mjs so a feed is never published
// with a signature that does not match its artifact or the committed pubkey.
//
// Formats (both files/strings are base64 of a minisign text file):
//   public key:  "untrusted comment: ...\n" + base64(Ed(2) | keyId(8) | key(32))
//   signature:   "untrusted comment: ...\n" + base64(Ed|ED(2) | keyId(8) | sig(64))
//                + "\ntrusted comment: ...\n" + base64(globalSig(64))
// `ED` signs the BLAKE2b-512 digest of the file, `Ed` signs the file itself.

import { createHash, createPublicKey, verify } from 'node:crypto';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function decodeText(base64) {
  return Buffer.from(base64.trim(), 'base64').toString('utf8');
}

/** Parses a base64-encoded minisign public key as stored in tauri.conf.json. */
export function parsePublicKey(base64) {
  const lines = decodeText(base64).split('\n').filter(Boolean);
  const raw = Buffer.from(lines[1] ?? '', 'base64');
  if (raw.length !== 42 || raw.toString('latin1', 0, 2) !== 'Ed') {
    throw new Error('updater public key is not a valid minisign Ed25519 key');
  }
  return { keyId: raw.subarray(2, 10), key: raw.subarray(10) };
}

function ed25519Verify(publicKey, message, signature) {
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]),
    format: 'der',
    type: 'spki'
  });
  return verify(null, message, key, signature);
}

/** Parses a base64-encoded minisign signature (the content of a `.sig` file). */
export function parseSignature(base64) {
  const lines = decodeText(base64).split('\n');
  const raw = Buffer.from(lines[1] ?? '', 'base64');
  const algorithm = raw.toString('latin1', 0, 2);
  if (raw.length !== 74 || (algorithm !== 'Ed' && algorithm !== 'ED')) {
    throw new Error('signature is not a valid minisign signature');
  }
  const trusted = (lines[2] ?? '').replace(/^trusted comment: /, '');
  const globalSignature = Buffer.from(lines[3] ?? '', 'base64');
  return {
    prehashed: algorithm === 'ED',
    keyId: raw.subarray(2, 10),
    signature: raw.subarray(10),
    trustedComment: trusted,
    globalSignature
  };
}

/**
 * Verifies `signatureBase64` for `data` against the base64 `publicKeyBase64`.
 * Throws with a descriptive message on any mismatch.
 */
export function verifyTauriSignature({ data, signatureBase64, publicKeyBase64 }) {
  const publicKey = parsePublicKey(publicKeyBase64);
  const sig = parseSignature(signatureBase64);

  if (!sig.keyId.equals(publicKey.keyId)) {
    throw new Error(
      `signed by key ${sig.keyId.reverse().toString('hex').toUpperCase()}, not the updater key ${Buffer.from(publicKey.keyId).reverse().toString('hex').toUpperCase()}`
    );
  }
  const message = sig.prehashed ? createHash('blake2b512').update(data).digest() : data;
  if (!ed25519Verify(publicKey.key, message, sig.signature)) {
    throw new Error('signature does not match the artifact');
  }
  const globalMessage = Buffer.concat([sig.signature, Buffer.from(sig.trustedComment, 'utf8')]);
  if (!ed25519Verify(publicKey.key, globalMessage, sig.globalSignature)) {
    throw new Error('signature trusted comment does not verify');
  }
}
