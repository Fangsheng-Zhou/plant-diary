// Backup file format (no browser-only APIs, so it can be tested on its own).
//
// A backup is one JSON file. Each space is a separate "section", encrypted
// with that space's own data key. The section also carries the space's
// locked (wrapped) key, so the file can be opened with nothing but the
// passphrase, even if the database no longer exists.

import { AAD, encryptBytes, decryptBytes, toB64, fromB64, unlockSpaceKey } from './crypto.js';

export const BACKUP_FORMAT = 'plant-diary-backup';
export const BACKUP_VERSION = 1;

const te = new TextEncoder();
const td = new TextDecoder();

export async function sealSection(spaceId, wrapping, key, content) {
  const payload = await encryptBytes(key, te.encode(JSON.stringify(content)), AAD.backup(spaceId));
  return {
    spaceId,
    kdfSalt: wrapping.kdfSalt,
    kdfIterations: wrapping.kdfIterations,
    wrappedKey: wrapping.wrappedKey,
    payload: toB64(payload),
  };
}

export function buildBackupText(sections, createdAt = new Date().toISOString()) {
  return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt, sections });
}

export function parseBackupText(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Plant Diary backup.');
  }
  if (!obj || obj.format !== BACKUP_FORMAT || !Array.isArray(obj.sections)) {
    throw new Error('This file is not a Plant Diary backup.');
  }
  if (obj.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of Plant Diary. Update the app first.');
  }
  return obj;
}

/** Decrypt one section. Throws WrongPassphraseError if the passphrase does not match. */
export async function openSection(section, passphrase) {
  const key = await unlockSpaceKey(passphrase, section.spaceId, {
    kdfSalt: section.kdfSalt, kdfIterations: section.kdfIterations, wrappedKey: section.wrappedKey,
  });
  const bytes = await decryptBytes(key, fromB64(section.payload), AAD.backup(section.spaceId));
  return JSON.parse(td.decode(bytes));
}
