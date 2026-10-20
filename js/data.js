// Data layer: sign-in, spaces, syncing, the offline queue and photos.
// Everything is encrypted here before it is written anywhere, and
// decrypted here after it is read.

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { local } from './localdb.js';
import {
  AAD, uuid, createSpaceKey, unlockSpaceKey, rewrapSpaceKey,
  encryptJSON, decryptJSON, encryptBytes, decryptBytes,
} from './crypto.js';
import { todayStr } from './model.js';
import { preparePhoto } from './images.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});

// ---------- Observable state ----------

export const state = {
  ready: false,          // first load finished
  user: null,
  recovery: false,       // arrived from a password-reset email
  spaces: [],            // decrypted spaces (see buildSpace)
  syncing: false,
  pending: 0,            // changes waiting to upload
  connection: 'ok',      // 'ok' | 'offline' | 'unreachable'
  lastSync: null,
  notice: null,          // short message for the user
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.error(e); }
  }
}
export function setNotice(text) {
  state.notice = text;
  emit();
}

const keys = new Map();          // spaceId -> CryptoKey (unlocked on this device)
const decCache = new Map();      // `${aad}` -> { data, value }
let serverRaw = emptyRaw();      // last data received from the server

function emptyRaw() {
  return { spaces: [], members: [], data: {} };
}

// ---------- Helpers ----------

async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

export function isNetworkError(e) {
  const msg = String((e && (e.message || e.error_description)) || e || '');
  if (/failed to fetch|load failed|networkerror|network request failed|fetch failed|timed? ?out/i.test(msg)) return true;
  const status = Number(e && (e.status ?? e.statusCode));
  if (status === 0 || status >= 500) return true;
  return false;
}

export function friendlyError(e) {
  if (!e) return 'Something went wrong.';
  if (!navigator.onLine) return 'You are offline. Try again when you have a connection.';
  if (isNetworkError(e)) return 'Could not reach the database. It may be paused, or the connection is weak.';
  return e.message || String(e);
}

function requireOnline() {
  if (!navigator.onLine) throw new Error('You are offline. This needs a connection.');
}

async function dec(key, cipher, aad) {
  if (!cipher) return null;
  const hit = decCache.get(aad);
  if (hit && hit.data === cipher) return hit.value;
  try {
    const value = await decryptJSON(key, cipher, aad);
    decCache.set(aad, { data: cipher, value });
    return value;
  } catch (e) {
    console.warn('Could not decrypt', aad, e);
    return null;
  }
}

const keyId = (spaceId) => `${state.user.id}:${spaceId}`;
export const myId = () => state.user?.id;
export const spaceById = (id) => state.spaces.find((s) => s.id === id);
export const isUnlocked = (spaceId) => keys.has(spaceId);

function storedName() {
  try { return localStorage.getItem('fk.name') || ''; } catch { return ''; }
}
function rememberName(name) {
  try { localStorage.setItem('fk.name', name); } catch { /* ignore */ }
}
export function myName(spaceId) {
  const s = spaceById(spaceId);
  const me = s?.members.find((m) => m.userId === myId());
  return (me && me.displayName) || storedName() || 'Me';
}
export function defaultName() {
  return storedName();
}

// ---------- Startup and auth ----------

export async function init() {
  const { data } = await sb.auth.getSession();
  state.user = data.session?.user ?? null;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') state.recovery = true;
    const next = session?.user ?? null;
    if ((next?.id || null) !== (state.user?.id || null)) {
      state.user = next;
      // Deferred: calling Supabase inside this callback can deadlock.
      if (next) setTimeout(() => loadForUser(), 0);
      else resetMemory();
    }
    emit();
  });
  if (state.user) await loadForUser();
  state.ready = true;
  emit();

  window.addEventListener('online', () => { state.connection = 'ok'; sync(); });
  window.addEventListener('offline', () => { state.connection = 'offline'; emit(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.user) sync();
  });
}

function resetMemory() {
  keys.clear();
  decCache.clear();
  serverRaw = emptyRaw();
  state.spaces = [];
  state.pending = 0;
}

async function loadForUser() {
  resetMemory();
  const uid = state.user.id;
  for (const k of (await local.keys('keys')) || []) {
    if (typeof k === 'string' && k.startsWith(`${uid}:`)) {
      const key = await local.get('keys', k);
      if (key) keys.set(k.slice(uid.length + 1), key);
    }
  }
  const cached = await local.get('cache', uid);
  await applyRaw(cached || emptyRaw());
  sync();
}

export async function signUp(email, password) {
  const redirect = location.origin + location.pathname;
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
  if (error) throw error;
  return { needsConfirmation: !data.session };
}

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function sendPasswordReset(email) {
  const redirect = location.origin + location.pathname;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect });
  if (error) throw error;
}

export async function setNewPassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
  state.recovery = false;
  emit();
}

export async function signOut() {
  const uid = state.user?.id;
  if (uid) {
    for (const k of (await local.keys('keys')) || []) {
      if (typeof k === 'string' && k.startsWith(`${uid}:`)) await local.del('keys', k);
    }
    await local.del('cache', uid);
  }
  await sb.auth.signOut();
  resetMemory();
  emit();
}

// ---------- Syncing ----------

let syncPromise = null;
export function sync() {
  if (!state.user) return Promise.resolve();
  if (!syncPromise) syncPromise = doSync().finally(() => { syncPromise = null; });
  return syncPromise;
}

async function myQueue() {
  const uid = state.user?.id;
  return (await local.queue()).filter((i) => i.uid === uid);
}

async function fetchAll(table, spaceId) {
  const out = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const rows = await q(sb.from(table).select('*').eq('space_id', spaceId).order('id').range(from, from + size - 1));
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

async function doSync() {
  if (!navigator.onLine) {
    state.connection = 'offline';
    emit();
    return;
  }
  state.syncing = true;
  emit();
  try {
    await flushOutbox();
    const uid = state.user.id;
    const [spaces, members] = await Promise.all([
      q(sb.from('spaces').select('*')),
      q(sb.from('space_members').select('*')),
    ]);
    const raw = { spaces, members, data: {} };
    for (const s of spaces) {
      const [plants, events, photos] = await Promise.all([
        fetchAll('plants', s.id), fetchAll('care_events', s.id), fetchAll('photos', s.id),
      ]);
      raw.data[s.id] = { plants, events, photos };
    }
    // Forget keys for spaces you are no longer part of.
    for (const id of [...keys.keys()]) {
      if (!spaces.some((s) => s.id === id)) {
        keys.delete(id);
        await local.del('keys', `${uid}:${id}`);
      }
    }
    if (state.user?.id !== uid) return;
    await local.set('cache', uid, raw);
    state.connection = 'ok';
    state.lastSync = Date.now();
    await applyRaw(raw);
  } catch (e) {
    console.warn('Sync failed', e);
    state.connection = !navigator.onLine ? 'offline' : (isNetworkError(e) ? 'unreachable' : 'ok');
    if (!isNetworkError(e)) state.notice = friendlyError(e);
  } finally {
    state.syncing = false;
    if (state.user) state.pending = (await myQueue()).length;
    emit();
  }
}

async function performItem(item) {
  switch (item.op) {
    case 'upsert':
      await q(sb.from(item.table).upsert(item.row));
      break;
    case 'delete':
      await q(sb.from(item.table).delete().eq('id', item.id));
      break;
    case 'upload': {
      const body = new Blob([item.bytes], { type: 'application/octet-stream' });
      const { error } = await sb.storage.from('photos').upload(item.path, body, {
        upsert: true, contentType: 'application/octet-stream',
      });
      if (error) throw error;
      break;
    }
    case 'remove': {
      const { error } = await sb.storage.from('photos').remove(item.paths);
      if (error) throw error;
      break;
    }
    default:
      break;
  }
}

async function flushOutbox() {
  for (const item of await myQueue()) {
    try {
      await performItem(item);
      await local.dequeue(item.seq);
    } catch (e) {
      if (isNetworkError(e)) throw e;
      // A permanent problem (for example the plant was deleted on the
      // other phone). Drop this change so the queue keeps moving.
      console.warn('Dropped a change that the server refused', item, e);
      await local.dequeue(item.seq);
    }
  }
}

const TABLE_KEY = { plants: 'plants', care_events: 'events', photos: 'photos' };

function overlay(raw, queue) {
  const view = { spaces: raw.spaces, members: raw.members, data: {} };
  for (const [sid, d] of Object.entries(raw.data || {})) {
    view.data[sid] = { plants: [...(d.plants || [])], events: [...(d.events || [])], photos: [...(d.photos || [])] };
  }
  for (const item of queue) {
    if (item.op === 'upsert' && TABLE_KEY[item.table]) {
      const sid = item.row.space_id;
      if (!view.data[sid]) view.data[sid] = { plants: [], events: [], photos: [] };
      const list = view.data[sid][TABLE_KEY[item.table]];
      const i = list.findIndex((r) => r.id === item.row.id);
      const merged = { ...(i >= 0 ? list[i] : {}), ...item.row, pending: true };
      if (i >= 0) list[i] = merged; else list.push(merged);
    } else if (item.op === 'delete' && TABLE_KEY[item.table]) {
      for (const d of Object.values(view.data)) {
        const list = d[TABLE_KEY[item.table]];
        const i = list.findIndex((r) => r.id === item.id);
        if (i >= 0) list.splice(i, 1);
        if (item.table === 'plants') {
          d.events = d.events.filter((r) => r.plant_id !== item.id);
          d.photos = d.photos.filter((r) => r.plant_id !== item.id);
        }
      }
    }
  }
  return view;
}

async function applyRaw(raw) {
  serverRaw = raw;
  if (!state.user) return;
  const uid = state.user.id;
  const queue = await myQueue();
  state.pending = queue.length;
  const view = overlay(raw, queue);
  const spaces = [];
  for (const row of view.spaces) {
    spaces.push(await buildSpace(row, view, uid));
  }
  spaces.sort((a, b) => (a.locked - b.locked) || a.createdAt.localeCompare(b.createdAt));
  state.spaces = spaces;
  emit();
}

async function buildSpace(row, view, uid) {
  const key = keys.get(row.id);
  const mine = view.members.find((m) => m.space_id === row.id && m.user_id === uid);
  const space = {
    id: row.id,
    createdAt: row.created_at || '',
    role: mine?.role || 'member',
    locked: !key,
    name: '',
    wrapping: { kdfSalt: row.kdf_salt, kdfIterations: row.kdf_iterations, wrappedKey: row.wrapped_key },
    members: [],
    plants: [],
    events: [],
    photos: [],
    needsProfile: Boolean(mine && !mine.enc_profile),
  };
  if (!key) return space;
  const meta = await dec(key, row.enc_meta, AAD.space(row.id));
  space.name = meta?.name || 'Untitled space';
  for (const m of view.members.filter((x) => x.space_id === row.id)) {
    const p = await dec(key, m.enc_profile, AAD.member(row.id, m.user_id));
    space.members.push({ userId: m.user_id, role: m.role, displayName: p?.displayName || 'Member' });
  }
  const d = view.data[row.id] || { plants: [], events: [], photos: [] };
  for (const r of d.plants) {
    const v = await dec(key, r.data, AAD.plant(r.id));
    if (v) space.plants.push({ ...v, id: r.id, spaceId: row.id, pending: !!r.pending });
  }
  for (const r of d.events) {
    const v = await dec(key, r.data, AAD.event(r.id));
    if (v) space.events.push({ ...v, id: r.id, spaceId: row.id, plantId: r.plant_id, createdBy: r.created_by });
  }
  for (const r of d.photos) {
    const v = await dec(key, r.data, AAD.photo(r.id));
    if (v) space.photos.push({ ...v, id: r.id, spaceId: row.id, plantId: r.plant_id });
  }
  return space;
}

async function queueChanges(items) {
  const uid = state.user.id;
  for (const it of items) await local.enqueue({ ...it, uid });
  await applyRaw(serverRaw);
  sync();
}

// ---------- Spaces ----------

async function storeKey(spaceId, key) {
  keys.set(spaceId, key);
  await local.set('keys', keyId(spaceId), key);
}

export async function createSpace(name, passphrase, displayName) {
  requireOnline();
  const id = uuid();
  const { kdfSalt, kdfIterations, wrappedKey, key } = await createSpaceKey(passphrase, id);
  const encMeta = await encryptJSON(key, { name }, AAD.space(id));
  const encProfile = await encryptJSON(key, { displayName }, AAD.member(id, myId()));
  await q(sb.rpc('create_space', {
    p_id: id, p_kdf_salt: kdfSalt, p_kdf_iterations: kdfIterations,
    p_wrapped_key: wrappedKey, p_enc_meta: encMeta, p_enc_profile: encProfile,
  }));
  rememberName(displayName);
  await storeKey(id, key);
  await sync();
  return id;
}

export async function joinSpace(code) {
  requireOnline();
  const spaceId = await q(sb.rpc('join_space', { p_code: code }));
  await sync();
  return spaceId;
}

export async function unlockSpace(spaceId, passphrase, displayName) {
  const space = spaceById(spaceId);
  if (!space) throw new Error('Space not found.');
  const key = await unlockSpaceKey(passphrase, spaceId, space.wrapping);
  await storeKey(spaceId, key);
  if (space.needsProfile && displayName) {
    try {
      await setDisplayName(spaceId, displayName);
    } catch (e) {
      console.warn('Could not save display name yet', e);
    }
  }
  await applyRaw(serverRaw);
  sync();
}

export async function lockSpace(spaceId) {
  keys.delete(spaceId);
  await local.del('keys', keyId(spaceId));
  await applyRaw(serverRaw);
}

export async function setDisplayName(spaceId, displayName) {
  requireOnline();
  const key = keys.get(spaceId);
  if (!key) throw new Error('Unlock this space first.');
  const enc = await encryptJSON(key, { displayName }, AAD.member(spaceId, myId()));
  await q(sb.from('space_members').update({ enc_profile: enc }).eq('space_id', spaceId).eq('user_id', myId()));
  rememberName(displayName);
  await sync();
}

export async function renameSpace(spaceId, name) {
  requireOnline();
  const key = keys.get(spaceId);
  const enc = await encryptJSON(key, { name }, AAD.space(spaceId));
  await q(sb.from('spaces').update({ enc_meta: enc }).eq('id', spaceId));
  await sync();
}

export async function changePassphrase(spaceId, oldPassphrase, newPassphrase) {
  requireOnline();
  const space = spaceById(spaceId);
  const w = await rewrapSpaceKey(oldPassphrase, newPassphrase, spaceId, space.wrapping);
  await q(sb.from('spaces').update({
    kdf_salt: w.kdfSalt, kdf_iterations: w.kdfIterations, wrapped_key: w.wrappedKey,
  }).eq('id', spaceId));
  await sync();
}

export async function createInvite(spaceId) {
  requireOnline();
  return q(sb.rpc('create_invite', { p_space: spaceId }));
}

export async function removeMember(spaceId, userId) {
  requireOnline();
  await q(sb.from('space_members').delete().eq('space_id', spaceId).eq('user_id', userId));
  await sync();
}

export async function leaveSpace(spaceId) {
  requireOnline();
  await q(sb.from('space_members').delete().eq('space_id', spaceId).eq('user_id', myId()));
  await lockSpace(spaceId);
  await sync();
}

export async function deleteSpace(spaceId) {
  requireOnline();
  const space = spaceById(spaceId);
  const paths = [];
  for (const p of space.photos) paths.push(`${spaceId}/${p.id}_t`, `${spaceId}/${p.id}_f`);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await sb.storage.from('photos').remove(paths.slice(i, i + 100));
    if (error) console.warn('Some photo files could not be removed', error);
  }
  await q(sb.from('spaces').delete().eq('id', spaceId));
  await lockSpace(spaceId);
  await sync();
}

// ---------- Plants, care logs, photos (these work offline) ----------

function keyFor(spaceId) {
  const key = keys.get(spaceId);
  if (!key) throw new Error('This space is locked on this device.');
  return key;
}

async function photoUploadItems(spaceId, photoId, file) {
  const key = keyFor(spaceId);
  const { full, thumb } = await preparePhoto(file);
  const items = [];
  for (const [size, bytes] of [['t', thumb], ['f', full]]) {
    const enc = await encryptBytes(key, bytes, AAD.photoFile(photoId, size));
    const path = `${spaceId}/${photoId}_${size}`;
    await local.set('blobs', path, enc);      // show it right away, even offline
    items.push({ op: 'upload', path, bytes: enc });
  }
  return items;
}

function plantData(p) {
  return {
    name: p.name || '',
    species: p.species || '',
    spot: p.spot || '',
    notes: p.notes || '',
    intervalDays: p.intervalDays || 7,
    coverPhotoId: p.coverPhotoId || null,
    addedOn: p.addedOn || todayStr(),
  };
}

async function plantRow(spaceId, id, data) {
  return { id, space_id: spaceId, data: await encryptJSON(keyFor(spaceId), plantData(data), AAD.plant(id)) };
}

async function eventItem(spaceId, plantId, type, date) {
  const id = uuid();
  const value = { type, date, at: new Date().toISOString(), by: myName(spaceId) };
  return {
    op: 'upsert', table: 'care_events',
    row: { id, space_id: spaceId, plant_id: plantId, data: await encryptJSON(keyFor(spaceId), value, AAD.event(id)) },
  };
}

async function photoRowItem(spaceId, plantId, photoId, value) {
  return {
    op: 'upsert', table: 'photos',
    row: { id: photoId, space_id: spaceId, plant_id: plantId, data: await encryptJSON(keyFor(spaceId), value, AAD.photo(photoId)) },
  };
}

/** Create or update a plant. Returns the plant id. */
export async function savePlant(spaceId, plantId, fields, { coverFile = null, lastWatered = null } = {}) {
  const isNew = !plantId;
  const id = plantId || uuid();
  const existing = isNew ? null : spaceById(spaceId)?.plants.find((p) => p.id === id);
  const data = { ...(existing || {}), ...fields };
  if (isNew) data.addedOn = todayStr();
  const items = [];
  let coverRow = null;
  if (coverFile) {
    const photoId = uuid();
    items.push(...await photoUploadItems(spaceId, photoId, coverFile));
    data.coverPhotoId = photoId;
    coverRow = await photoRowItem(spaceId, id, photoId, { date: todayStr(), kind: 'cover' });
  }
  items.push({ op: 'upsert', table: 'plants', row: await plantRow(spaceId, id, data) });
  if (coverRow) items.push(coverRow);
  if (isNew && lastWatered) items.push(await eventItem(spaceId, id, 'water', lastWatered));
  await queueChanges(items);
  return id;
}

export async function logCare(plant, type, date = todayStr()) {
  await queueChanges([await eventItem(plant.spaceId, plant.id, type, date)]);
}

export async function deleteEvent(event) {
  await queueChanges([{ op: 'delete', table: 'care_events', id: event.id }]);
}

export async function addProgressPhoto(plant, file, date = todayStr()) {
  const photoId = uuid();
  const items = await photoUploadItems(plant.spaceId, photoId, file);
  items.push(await photoRowItem(plant.spaceId, plant.id, photoId, { date, kind: 'progress' }));
  await queueChanges(items);
}

export async function updatePhoto(photo, changes) {
  const value = { date: photo.date, kind: photo.kind, ...changes };
  await queueChanges([await photoRowItem(photo.spaceId, photo.plantId, photo.id, value)]);
}

export async function setCoverPhoto(plant, photoId) {
  await queueChanges([{ op: 'upsert', table: 'plants', row: await plantRow(plant.spaceId, plant.id, { ...plant, coverPhotoId: photoId }) }]);
}

export async function deletePhoto(photo) {
  const space = spaceById(photo.spaceId);
  const plant = space?.plants.find((p) => p.id === photo.plantId);
  const items = [];
  if (plant && plant.coverPhotoId === photo.id) {
    items.push({ op: 'upsert', table: 'plants', row: await plantRow(plant.spaceId, plant.id, { ...plant, coverPhotoId: null }) });
  }
  items.push({ op: 'delete', table: 'photos', id: photo.id });
  items.push({ op: 'remove', paths: [`${photo.spaceId}/${photo.id}_t`, `${photo.spaceId}/${photo.id}_f`] });
  await queueChanges(items);
}

export async function deletePlant(plant) {
  const space = spaceById(plant.spaceId);
  const paths = [];
  for (const p of space.photos.filter((x) => x.plantId === plant.id)) {
    paths.push(`${plant.spaceId}/${p.id}_t`, `${plant.spaceId}/${p.id}_f`);
  }
  const items = [];
  if (paths.length) items.push({ op: 'remove', paths });
  items.push({ op: 'delete', table: 'plants', id: plant.id });
  await queueChanges(items);
}

// ---------- Reading photos ----------

const urlCache = new Map();

/** Decrypted photo bytes (JPEG). size: 't' thumbnail or 'f' full. */
export async function photoBytes(spaceId, photoId, size) {
  const path = `${spaceId}/${photoId}_${size}`;
  let enc = await local.get('blobs', path);
  if (!enc) {
    const { data, error } = await sb.storage.from('photos').download(path);
    if (error) throw error;
    enc = new Uint8Array(await data.arrayBuffer());
    await local.set('blobs', path, enc);
  }
  return decryptBytes(keyFor(spaceId), enc, AAD.photoFile(photoId, size));
}

export function photoURL(spaceId, photoId, size = 't') {
  const path = `${spaceId}/${photoId}_${size}`;
  if (!urlCache.has(path)) {
    const p = photoBytes(spaceId, photoId, size)
      .then((bytes) => URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })))
      .catch((e) => {
        urlCache.delete(path);
        throw e;
      });
    urlCache.set(path, p);
  }
  return urlCache.get(path);
}

// ---------- Used by backups ----------

export function spaceKey(spaceId) {
  return keys.get(spaceId);
}

/** Restore helper: writes a whole space's content directly (online only). */
export async function writeRestoredContent(spaceId, { plants, events, photos }, onProgress) {
  requireOnline();
  const key = keyFor(spaceId);
  const total = plants.length + events.length + photos.length;
  let done = 0;
  const tick = () => onProgress && onProgress(++done, total);
  for (const p of plants) {
    await q(sb.from('plants').upsert({ id: p.id, space_id: spaceId, data: await encryptJSON(key, plantData(p), AAD.plant(p.id)) }));
    tick();
  }
  for (const ph of photos) {
    for (const [size, bytes] of [['t', ph.thumb], ['f', ph.full]]) {
      const enc = await encryptBytes(key, bytes, AAD.photoFile(ph.id, size));
      const { error } = await sb.storage.from('photos').upload(`${spaceId}/${ph.id}_${size}`,
        new Blob([enc], { type: 'application/octet-stream' }), { upsert: true, contentType: 'application/octet-stream' });
      if (error) throw error;
    }
    await q(sb.from('photos').upsert({
      id: ph.id, space_id: spaceId, plant_id: ph.plantId,
      data: await encryptJSON(key, { date: ph.date, kind: ph.kind }, AAD.photo(ph.id)),
    }));
    tick();
  }
  for (let i = 0; i < events.length; i += 200) {
    const rows = [];
    for (const e of events.slice(i, i + 200)) {
      rows.push({
        id: e.id, space_id: spaceId, plant_id: e.plantId,
        data: await encryptJSON(key, { type: e.type, date: e.date, at: e.at, by: e.by }, AAD.event(e.id)),
      });
    }
    await q(sb.from('care_events').upsert(rows));
    for (let j = 0; j < rows.length; j++) tick();
  }
  await sync();
}

export { requireOnline };
