// Export and restore encrypted backups.

import { state, spaceKey, photoBytes, createSpace, writeRestoredContent, requireOnline } from './data.js';
import { sealSection, buildBackupText, parseBackupText, openSection } from './backup-core.js';
import { toB64, fromB64, uuid } from './crypto.js';
import { todayStr } from './model.js';
import { thumbFromJpeg } from './images.js';

export async function exportBackup(onProgress) {
  const spaces = state.spaces.filter((s) => !s.locked);
  if (!spaces.length) throw new Error('Unlock at least one space first.');
  const totalPhotos = spaces.reduce((n, s) => n + s.photos.length, 0);
  let done = 0;
  let missing = 0;
  const sections = [];
  for (const s of spaces) {
    const content = {
      name: s.name,
      plants: s.plants.map((p) => ({
        id: p.id, name: p.name, species: p.species, spot: p.spot, notes: p.notes,
        intervalDays: p.intervalDays, coverPhotoId: p.coverPhotoId, addedOn: p.addedOn,
      })),
      events: s.events.map((e) => ({ id: e.id, plantId: e.plantId, type: e.type, date: e.date, at: e.at, by: e.by })),
      photos: [],
    };
    for (const ph of s.photos) {
      try {
        const bytes = await photoBytes(s.id, ph.id, 'f');
        content.photos.push({ id: ph.id, plantId: ph.plantId, date: ph.date, kind: ph.kind, jpeg: toB64(bytes) });
      } catch (e) {
        console.warn('Photo not included', ph.id, e);
        missing++;
      }
      onProgress && onProgress(++done, totalPhotos);
    }
    sections.push(await sealSection(s.id, s.wrapping, spaceKey(s.id), content));
  }
  const text = buildBackupText(sections);
  const file = new File([text], `plant-diary-backup-${todayStr()}.json`, { type: 'application/json' });
  return {
    file, missing,
    spaces: spaces.length,
    plants: spaces.reduce((n, s) => n + s.plants.length, 0),
    photos: totalPhotos - missing,
  };
}

/** Opens the iPhone share sheet (Save to Files, iCloud Drive, Google Drive), or downloads. */
export async function saveFile(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Plant Diary backup' });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

export async function readBackupFile(file) {
  return parseBackupText(await file.text());
}

/** Restore one section into a NEW space named "<name> (restored)". */
export async function restoreSection(section, passphrase, displayName, onProgress) {
  requireOnline();
  const content = await openSection(section, passphrase);
  const plantIds = new Map(content.plants.map((p) => [p.id, uuid()]));
  const photoIds = new Map(content.photos.map((p) => [p.id, uuid()]));
  const plants = content.plants.map((p) => ({
    ...p,
    id: plantIds.get(p.id),
    coverPhotoId: p.coverPhotoId ? (photoIds.get(p.coverPhotoId) || null) : null,
  }));
  const photos = [];
  for (const ph of content.photos) {
    if (!plantIds.has(ph.plantId)) continue;
    const full = fromB64(ph.jpeg);
    photos.push({
      id: photoIds.get(ph.id), plantId: plantIds.get(ph.plantId),
      date: ph.date, kind: ph.kind, full, thumb: await thumbFromJpeg(full),
    });
  }
  const events = content.events
    .filter((e) => plantIds.has(e.plantId))
    .map((e) => ({ ...e, id: uuid(), plantId: plantIds.get(e.plantId) }));
  const spaceId = await createSpace(`${content.name} (restored)`, passphrase, displayName);
  await writeRestoredContent(spaceId, { plants, events, photos }, onProgress);
  return { spaceId, name: content.name, plants: plants.length, photos: photos.length, events: events.length };
}
