// Minimal semver helpers for release scripts. Handles X.Y.Z and
// X.Y.Z-<prerelease> (dot-separated identifiers); build metadata is rejected
// because the release scheme deliberately never uses it.

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

/** Parses `X.Y.Z[-prerelease]`; throws on anything else, including build metadata. */
export function parseSemver(text) {
  const match = SEMVER.exec(text);
  if (!match) throw new Error(`'${text}' is not a valid semver version`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : []
  };
}

/** Whether a prerelease identifier is all digits. */
const isNumeric = (id) => /^\d+$/.test(id);

/** Compares prerelease identifier lists by semver precedence. */
function comparePre(a, b) {
  // A version without a prerelease sorts above one with.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    if (a[i] === b[i]) continue;
    const an = isNumeric(a[i]);
    const bn = isNumeric(b[i]);
    if (an && bn) return Number(a[i]) < Number(b[i]) ? -1 : 1;
    if (an) return -1;
    if (bn) return 1;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** Returns -1, 0 or 1 following semver precedence. */
export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  return comparePre(a.pre, b.pre);
}
