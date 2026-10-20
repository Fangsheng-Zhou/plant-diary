// End-to-end encryption for Plant Diary.
//
// Each space has a random 256-bit "data key". Everything in the space
// (plant details, care logs, photos, member names) is encrypted with it
// using AES-256-GCM before it leaves the phone.
//
// The data key itself is stored in the database only in "wrapped" form:
// locked with a key derived from the space passphrase (PBKDF2-SHA-256).
// Without the passphrase, nobody (including the database provider) can
// unwrap it. Changing the passphrase only re-wraps the data key, so
// nothing else needs re-encrypting.
//
// Every ciphertext is bound to where it belongs (for example
// "plants:<id>") as additional authenticated data, so a record cannot
// be silently swapped with another one.

export const KDF_ITERATIONS = 600000;

const te = new TextEncoder();
const td = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

export class WrongPassphraseError extends Error {
  constructor() {
    super('That passphrase is not correct.');
    this.name = 'WrongPassphraseError';
  }
}

export function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function uuid() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function toB64(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < u.length; i += chunk) {
    s += String.fromCharCode.apply(null, u.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function fromB64(str) {
  const s = atob(str);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function normalizePassphrase(p) {
  return te.encode(String(p).normalize('NFKC'));
}

async function deriveKek(passphrase, saltB64, iterations) {
  const base = await subtle().importKey('raw', normalizePassphrase(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: fromB64(saltB64), iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function wrapWith(dataKey, passphrase, spaceId, iterations = KDF_ITERATIONS) {
  const salt = toB64(randomBytes(16));
  const kek = await deriveKek(passphrase, salt, iterations);
  const iv = randomBytes(12);
  const wrapped = new Uint8Array(await subtle().wrapKey('raw', dataKey, kek, {
    name: 'AES-GCM', iv, additionalData: te.encode(`wrap:${spaceId}`),
  }));
  return { kdfSalt: salt, kdfIterations: iterations, wrappedKey: toB64(concat(iv, wrapped)) };
}

/** Create the keys for a brand-new space. Returns the wrapping info to store and the usable key. */
export async function createSpaceKey(passphrase, spaceId, iterations = KDF_ITERATIONS) {
  const raw = randomBytes(32);
  const extractable = await subtle().importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  const wrapping = await wrapWith(extractable, passphrase, spaceId, iterations);
  const key = await subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  raw.fill(0);
  return { ...wrapping, key };
}

/** Unlock a space's data key with its passphrase. Throws WrongPassphraseError if it does not match. */
export async function unlockSpaceKey(passphrase, spaceId, wrapping, extractable = false) {
  const kek = await deriveKek(passphrase, wrapping.kdfSalt, wrapping.kdfIterations);
  const bytes = fromB64(wrapping.wrappedKey);
  try {
    return await subtle().unwrapKey(
      'raw', bytes.subarray(12), kek,
      { name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: te.encode(`wrap:${spaceId}`) },
      { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt'],
    );
  } catch {
    throw new WrongPassphraseError();
  }
}

/** Change a space passphrase. Only the wrapping changes; existing data stays readable. */
export async function rewrapSpaceKey(oldPassphrase, newPassphrase, spaceId, wrapping) {
  const key = await unlockSpaceKey(oldPassphrase, spaceId, wrapping, true);
  return wrapWith(key, newPassphrase, spaceId, wrapping.kdfIterations);
}

export async function encryptBytes(key, bytes, aad) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, bytes,
  ));
  return concat(iv, ct);
}

export async function decryptBytes(key, bytes, aad) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pt = await subtle().decrypt(
    { name: 'AES-GCM', iv: u.subarray(0, 12), additionalData: te.encode(aad) }, key, u.subarray(12),
  );
  return new Uint8Array(pt);
}

export async function encryptJSON(key, value, aad) {
  return toB64(await encryptBytes(key, te.encode(JSON.stringify(value)), aad));
}

export async function decryptJSON(key, b64, aad) {
  return JSON.parse(td.decode(await decryptBytes(key, fromB64(b64), aad)));
}

// Where each kind of record is bound. Keep these stable across versions.
export const AAD = {
  space: (spaceId) => `spaces:${spaceId}`,
  member: (spaceId, userId) => `members:${spaceId}:${userId}`,
  plant: (id) => `plants:${id}`,
  event: (id) => `care_events:${id}`,
  photo: (id) => `photos:${id}`,
  photoFile: (id, size) => `photofile:${id}:${size}`,
  backup: (spaceId) => `backup:${spaceId}`,
};
