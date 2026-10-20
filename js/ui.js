// Screens and interactions.

import * as D from './data.js';
import { state } from './data.js';
import {
  CARE_TYPES, todayStr, formatDay, relativeDay, sortEventsNewestFirst, lastEvent,
  daysUntilWatering, wateringStatus, nextWateringDay, intervalOf, isValidDay,
} from './model.js';
import { icon, careIcon } from './icons.js';
import { PRESETS, MODES, loadTheme, saveTheme, applyTheme, fromPreset, defaultTheme } from './theme.js';
import { exportBackup, saveFile, readBackupFile, restoreSection } from './backup.js';
import { WrongPassphraseError } from './crypto.js';
import { APP_NAME, APP_VERSION, SOURCE_URL, SUPABASE_DASHBOARD } from './config.js';

const root = document.getElementById('app');
let theme = loadTheme();
let lastRouteKey = '';
let authMode = 'signin';

// ---------- Small helpers ----------

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function currentFilter() {
  try { return localStorage.getItem('fk.space') || 'all'; } catch { return 'all'; }
}
function setFilter(v) {
  try { localStorage.setItem('fk.space', v); } catch { /* ignore */ }
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function route() {
  const h = location.hash || '';
  if (/access_token|error_description|type=(signup|recovery|invite|magiclink)/.test(h)) return { name: 'home' };
  const parts = h.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'plant' && parts[1] && parts[2] === 'edit') return { name: 'edit', id: parts[1] };
  if (parts[0] === 'plant' && parts[1]) return { name: 'plant', id: parts[1] };
  if (parts[0] === 'new') return { name: 'new' };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'space' && parts[1]) return { name: 'space', id: parts[1] };
  return { name: 'home' };
}

function go(hash) {
  if (location.hash === hash) render(true);
  else location.hash = hash;
}

function findPlant(id) {
  for (const s of state.spaces) {
    const p = s.plants.find((x) => x.id === id);
    if (p) return { plant: p, space: s };
  }
  return { plant: null, space: null };
}

const unlockedSpaces = () => state.spaces.filter((s) => !s.locked);
const eventsFor = (space, plantId) => space.events.filter((e) => e.plantId === plantId);

// ---------- Toasts and dialogs ----------

let toastTimer = null;
export function toast(message, actionLabel, onAction) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>${esc(message)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
  el.className = 'show';
  if (actionLabel) {
    el.querySelector('button').onclick = () => {
      el.className = '';
      onAction && onAction();
    };
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, actionLabel ? 5000 : 2600);
}

function dialog(innerHtml, { onReady } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet';
    dlg.innerHTML = innerHtml;
    document.body.appendChild(dlg);
    let result = null;
    const close = (value) => {
      result = value;
      dlg.close();
    };
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-close]');
      if (b) close(b.dataset.close === 'true' ? true : null);
      // Tapping outside closes simple dialogs, never ones with a form being filled in.
      if (e.target === dlg && !dlg.querySelector('form')) close(null);
    });
    dlg.showModal();
    if (onReady) onReady(dlg, close);
  });
}

function confirmDialog(title, message, confirmLabel = 'OK', danger = false) {
  return dialog(`
    <h2>${esc(title)}</h2>
    ${message ? `<p class="muted">${esc(message)}</p>` : ''}
    <div class="dialog-actions">
      <button type="button" class="btn btn-secondary" data-close="false">Cancel</button>
      <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-close="true">${esc(confirmLabel)}</button>
    </div>`);
}

/** A dialog containing a form. `submit(form, close)` may throw to show an error. */
function formDialog(title, fieldsHtml, submitLabel, submit, { intro = '' } = {}) {
  return dialog(`
    <form method="dialog" class="dialog-form" novalidate>
      <h2>${esc(title)}</h2>
      ${intro}
      ${fieldsHtml}
      <p class="form-error" role="alert" hidden></p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-secondary" data-close="false">Cancel</button>
        <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
      </div>
    </form>`, {
    onReady: (dlg, close) => {
      const form = dlg.querySelector('form');
      const err = form.querySelector('.form-error');
      const btn = form.querySelector('button[type=submit]');
      const first = form.querySelector('input:not([type=hidden]), textarea, select');
      if (first) setTimeout(() => first.focus(), 50);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.hidden = true;
        btn.disabled = true;
        const label = btn.textContent;
        btn.textContent = 'Working...';
        try {
          const value = await submit(form);
          close(value === undefined ? true : value);
        } catch (ex) {
          err.textContent = ex instanceof WrongPassphraseError ? ex.message : D.friendlyError(ex);
          err.hidden = false;
          btn.disabled = false;
          btn.textContent = label;
        }
      });
    },
  });
}

const passField = (name, label, autocomplete = 'off') => `
  <label class="field"><span>${esc(label)}</span>
    <input name="${name}" type="password" autocomplete="${autocomplete}" autocapitalize="off" spellcheck="false" required>
  </label>`;

const textField = (name, label, value = '', attrs = '') => `
  <label class="field"><span>${esc(label)}</span>
    <input name="${name}" type="text" value="${esc(value)}" ${attrs}>
  </label>`;

function checkNewPassphrase(a, b) {
  if (a.length < 10) throw new Error('Use at least 10 characters. Four random words work well.');
  if (a !== b) throw new Error('The two passphrases do not match.');
}

// ---------- Photo hydration ----------

function photoImg(spaceId, photoId, size, cls = '', alt = '') {
  if (!photoId) return `<span class="ph-empty ${cls}">${icon.sprout}</span>`;
  return `<img class="${cls}" alt="${esc(alt)}" data-photo="${esc(spaceId)}|${esc(photoId)}|${size}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">`;
}

function hydratePhotos() {
  for (const img of root.querySelectorAll('img[data-photo]')) {
    const [spaceId, photoId, size] = img.dataset.photo.split('|');
    D.photoURL(spaceId, photoId, size).then((url) => {
      img.src = url;
      img.classList.add('loaded');
    }).catch(() => img.classList.add('failed'));
  }
}

// ---------- Banners ----------

function banners() {
  const out = [];
  if (state.connection === 'offline') {
    out.push(`<div class="banner">You are offline. Changes are saved on this phone and upload when you reconnect.</div>`);
  } else if (state.connection === 'unreachable') {
    out.push(`<div class="banner warn">
      <strong>Can't reach your database.</strong> If it was paused, the person who set up Plant Diary can wake it in the Supabase dashboard. Your changes are kept on this phone meanwhile.
      <div class="banner-actions"><a class="btn btn-small btn-primary" href="${SUPABASE_DASHBOARD}" target="_blank" rel="noopener">Open dashboard</a>
      <button type="button" class="btn btn-small btn-secondary" data-action="sync">Try again</button></div></div>`);
  } else if (state.pending > 0) {
    out.push(`<div class="banner subtle">Uploading ${plural(state.pending, 'change')}...</div>`);
  }
  if (state.notice) {
    out.push(`<div class="banner warn">${esc(state.notice)} <button type="button" class="link" data-action="dismiss-notice">Dismiss</button></div>`);
  }
  return out.join('');
}

// ---------- Screens ----------

function viewLoading() {
  return `<div class="center-screen"><img class="app-icon" src="icons/icon-192.png" alt=""><p class="muted">Loading...</p></div>`;
}

function viewAuth() {
  const install = !isStandalone() && /iPhone|iPad/.test(navigator.userAgent)
    ? `<div class="banner subtle">Tip: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>, and sign in from the home screen icon. iPhone keeps home screen apps separate from Safari.</div>`
    : '';
  const isUp = authMode === 'signup';
  const isReset = authMode === 'reset';
  return `
  <main class="auth">
    <img class="app-icon big" src="icons/icon-192.png" alt="">
    <h1 class="app-title">${APP_NAME}</h1>
    <p class="muted center">Keep track of watering, feeding and growth. Private and encrypted.</p>
    ${install}
    ${banners()}
    <form id="auth-form" class="card form-card" novalidate>
      <label class="field"><span>Email</span>
        <input name="email" type="email" autocomplete="email" autocapitalize="off" required></label>
      ${isReset ? '' : `<label class="field"><span>Password</span>
        <input name="password" type="password" autocomplete="${isUp ? 'new-password' : 'current-password'}" required minlength="8"></label>`}
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">${isUp ? 'Create account' : isReset ? 'Send reset link' : 'Sign in'}</button>
    </form>
    <div class="auth-links">
      ${isUp || isReset ? `<button class="link" data-action="auth-mode" data-mode="signin">I already have an account</button>`
        : `<button class="link" data-action="auth-mode" data-mode="signup">Create an account</button>
           <button class="link" data-action="auth-mode" data-mode="reset">Forgot password?</button>`}
    </div>
  </main>`;
}

function viewRecovery() {
  return `
  <main class="auth">
    <h1 class="app-title">Set a new password</h1>
    <form id="recovery-form" class="card form-card" novalidate>
      <label class="field"><span>New password</span>
        <input name="password" type="password" autocomplete="new-password" required minlength="8"></label>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Save password</button>
    </form>
  </main>`;
}

function viewOnboarding() {
  return `
  <main class="page">
    <h1 class="big-title">Welcome</h1>
    ${banners()}
    <p class="muted">Plants live in <strong>spaces</strong>, such as Home or Work. Each space is shared with the people you invite and locked with its own passphrase.</p>
    <section class="card pad">
      <h2>Create a space</h2>
      <p class="muted">Start with Home. You can add Work or others later.</p>
      <button class="btn btn-primary btn-block" data-action="new-space" data-default="Home">Create a space</button>
    </section>
    <section class="card pad">
      <h2>Join a space</h2>
      <p class="muted">Got an invite code from your partner? Use it here, then enter the passphrase they told you.</p>
      <button class="btn btn-secondary btn-block" data-action="join-space">Enter invite code</button>
    </section>
    <p class="center"><button class="link" data-action="sign-out">Sign out</button></p>
  </main>`;
}

function plantRow(plant, space, showSpace) {
  const events = eventsFor(space, plant.id);
  const days = daysUntilWatering(plant, events);
  const st = wateringStatus(days);
  const sub = [plant.species, plant.spot, showSpace ? space.name : ''].filter(Boolean).map(esc).join(' &middot; ');
  return `
  <li class="plant-row">
    <a class="plant-link" href="#/plant/${esc(plant.id)}">
      <span class="thumb">${photoImg(space.id, plant.coverPhotoId, 't', '', plant.name)}</span>
      <span class="info">
        <span class="name">${esc(plant.name || 'Unnamed plant')}</span>
        ${sub ? `<span class="sub">${sub}</span>` : ''}
        <span class="status ${st.tone}">${icon.drop}${esc(st.text)}</span>
      </span>
    </a>
    <button type="button" class="water-btn" data-action="quick-water" data-plant="${esc(plant.id)}" aria-label="Log watering for ${esc(plant.name)}">${icon.drop}</button>
  </li>`;
}

function viewHome() {
  const filter = currentFilter();
  const unlocked = unlockedSpaces();
  const showAll = filter === 'all' || !state.spaces.some((s) => s.id === filter);
  const visible = showAll ? unlocked : unlocked.filter((s) => s.id === filter);
  const locked = state.spaces.filter((s) => s.locked && (showAll || s.id === filter));

  const chips = state.spaces.length > 1 ? `
    <nav class="chips" aria-label="Spaces">
      <button class="chip ${showAll ? 'on' : ''}" data-action="filter" data-space="all">All</button>
      ${state.spaces.map((s) => `<button class="chip ${!showAll && s.id === filter ? 'on' : ''}" data-action="filter" data-space="${esc(s.id)}">${s.locked ? icon.lock : ''}${esc(s.locked ? 'Locked space' : s.name)}</button>`).join('')}
    </nav>` : '';

  const items = [];
  for (const s of visible) for (const p of s.plants) items.push({ p, s, days: daysUntilWatering(p, eventsFor(s, p.id)) });
  items.sort((a, b) => a.days - b.days || a.p.name.localeCompare(b.p.name));
  const due = items.filter((i) => i.days <= 0);
  const later = items.filter((i) => i.days > 0);
  const multi = showAll && unlocked.length > 1;

  const lockedCards = locked.map((s) => `
    <section class="card pad locked-card">
      <div class="locked-head">${icon.lock}<div><strong>A space is locked on this phone</strong>
      <p class="muted">Enter its passphrase once to see its plants.</p></div></div>
      <button class="btn btn-primary btn-block" data-action="unlock" data-space="${esc(s.id)}">Unlock</button>
    </section>`).join('');

  let list = '';
  if (!visible.length && !locked.length) {
    list = '';
  } else if (!items.length && visible.length) {
    list = `<section class="empty">
      <div class="logo-mark">${icon.sprout}</div>
      <p>No plants here yet.</p>
      <button class="btn btn-primary" data-action="add-plant">Add a plant</button></section>`;
  } else {
    if (due.length) {
      list += `<h2 class="section-title">Needs water</h2><ul class="card list">${due.map((i) => plantRow(i.p, i.s, multi)).join('')}</ul>`;
    }
    if (later.length) {
      list += `<h2 class="section-title">${due.length ? 'Coming up' : 'All watered'}</h2><ul class="card list">${later.map((i) => plantRow(i.p, i.s, multi)).join('')}</ul>`;
    }
    list += `<p class="hint">Tap the drop to log a watering for today.</p>`;
  }

  const install = !isStandalone() && /iPhone|iPad/.test(navigator.userAgent) && !localStorage.getItem('fk.installHint')
    ? `<div class="banner subtle">Add Plant Diary to your home screen: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. <button class="link" data-action="hide-install">Hide</button></div>` : '';

  const addSpaceTip = state.spaces.length === 1 && unlocked.length === 1 && !localStorage.getItem('fk.spaceTip')
    ? `<div class="banner subtle">Want to track plants at work separately? <button class="link" data-action="new-space" data-default="Work">Add a Work space</button> <button class="link" data-action="hide-space-tip">Not now</button></div>` : '';

  return `
  <header class="navbar">
    <button class="icon-btn" data-action="go" data-to="#/settings" aria-label="Settings and appearance">${icon.sliders}</button>
    <span class="nav-title"></span>
    ${unlocked.length ? `<button class="icon-btn accent" data-action="add-plant" aria-label="Add plant">${icon.plus}</button>` : '<span></span>'}
  </header>
  <main class="page">
    <h1 class="big-title">My Plants</h1>
    ${banners()}
    ${install}
    ${chips}
    ${addSpaceTip}
    ${lockedCards}
    ${list}
  </main>`;
}

function careRow(type, space, events) {
  const last = lastEvent(events, type);
  return `<li class="kv">
    ${careIcon(type)}<span class="kv-label">${CARE_TYPES[type].past}</span>
    <span class="kv-value">${last ? `${esc(relativeDay(last.date))}${last.by ? `<small>by ${esc(last.by)}</small>` : ''}` : 'Never'}</span>
  </li>`;
}

function viewPlant(id) {
  const { plant, space } = findPlant(id);
  if (!plant) {
    return `<header class="navbar"><button class="icon-btn" data-action="go" data-to="#/" aria-label="Back">${icon.back}</button><span></span><span></span></header>
      <main class="page"><p class="muted">This plant is no longer here.</p></main>`;
  }
  const events = eventsFor(space, plant.id);
  const days = daysUntilWatering(plant, events);
  const st = wateringStatus(days);
  const history = sortEventsNewestFirst(events);
  const photos = space.photos.filter((p) => p.plantId === plant.id && p.kind !== 'cover')
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const interval = intervalOf(plant);
  return `
  <header class="navbar">
    <button class="icon-btn" data-action="go" data-to="#/" aria-label="Back">${icon.back}</button>
    <span class="nav-title">${esc(plant.name)}</span>
    <a class="nav-text" href="#/plant/${esc(plant.id)}/edit">Edit</a>
  </header>
  <main class="page">
    ${banners()}
    <section class="hero">
      <div class="hero-photo">${photoImg(space.id, plant.coverPhotoId, 'f', '', plant.name)}</div>
      <h1>${esc(plant.name || 'Unnamed plant')}</h1>
      ${plant.species ? `<p class="hero-sub">${esc(plant.species)}</p>` : ''}
      <p class="hero-meta">${[plant.spot, unlockedSpaces().length > 1 ? space.name : '', `Water every ${plural(interval, 'day')}`].filter(Boolean).map(esc).join(' &middot; ')}</p>
    </section>

    <h2 class="section-title">Care</h2>
    <section class="card pad-sm">
      <div class="care-buttons">
        <button class="btn btn-care wide" data-action="log" data-type="water" data-plant="${esc(plant.id)}"><span class="ci water">${icon.drop}</span>Water</button>
        <button class="btn btn-care" data-action="log" data-type="feed" data-plant="${esc(plant.id)}"><span class="ci feed">${icon.leaf}</span>Feed</button>
        <button class="btn btn-care" data-action="log" data-type="repot" data-plant="${esc(plant.id)}"><span class="ci repot">${icon.repot}</span>Repot</button>
      </div>
      <ul class="kv-list">
        <li class="kv"><span class="care-icon cal">${icon.calendar}</span><span class="kv-label">Next watering</span>
          <span class="kv-value status ${st.tone}">${esc(st.text)}<small>${esc(formatDay(nextWateringDay(plant, events)))}</small></span></li>
        ${careRow('water', space, events)}
        ${careRow('feed', space, events)}
        ${careRow('repot', space, events)}
      </ul>
      <button class="row-btn" data-action="log-other" data-plant="${esc(plant.id)}">${icon.calendar}<span>Log a different date</span></button>
    </section>

    <h2 class="section-title">Progress photos</h2>
    <section class="card pad-sm">
      ${photos.length ? `<div class="photo-strip">${photos.map((ph) => `
        <button class="photo-tile" data-action="view-photo" data-photo-id="${esc(ph.id)}" data-plant="${esc(plant.id)}">
          ${photoImg(space.id, ph.id, 't')}
          <span>${esc(formatDay(ph.date))}</span>
        </button>`).join('')}</div>` : ''}
      <label class="row-btn file-btn">${icon.camera}<span>Add progress photo</span>
        <input type="file" accept="image/*" data-action="add-progress" data-plant="${esc(plant.id)}" hidden>
      </label>
    </section>

    <h2 class="section-title">Care history</h2>
    <section class="card">
      ${history.length ? `<ul class="kv-list">${history.slice(0, 60).map((e) => `
        <li class="kv tappable" data-action="event-menu" data-event="${esc(e.id)}" data-plant="${esc(plant.id)}">
          ${careIcon(e.type)}<span class="kv-label">${esc(CARE_TYPES[e.type]?.past || e.type)}${e.by ? `<small>by ${esc(e.by)}</small>` : ''}</span>
          <span class="kv-value">${esc(formatDay(e.date))}</span>
        </li>`).join('')}</ul>
        ${history.length > 60 ? `<p class="hint pad-sm">Showing the latest 60 of ${history.length}.</p>` : ''}`
      : '<p class="muted pad">Nothing logged yet.</p>'}
    </section>
    ${history.length ? '<p class="hint">Tap an entry to remove it.</p>' : ''}

    ${plant.notes ? `<h2 class="section-title">Care instructions</h2><section class="card pad notes">${esc(plant.notes)}</section>` : ''}

    <section class="card">
      <button class="row-btn danger" data-action="delete-plant" data-plant="${esc(plant.id)}">${icon.trash}<span>Delete plant</span></button>
    </section>
  </main>`;
}

function viewForm(id) {
  const editing = id ? findPlant(id) : { plant: null, space: null };
  if (id && !editing.plant) return viewPlant(id);
  const p = editing.plant || { name: '', species: '', spot: '', notes: '', intervalDays: 7 };
  const spaces = unlockedSpaces();
  const filter = currentFilter();
  const defaultSpace = editing.space?.id || (spaces.find((s) => s.id === filter) || spaces[0])?.id;
  return `
  <header class="navbar">
    <a class="nav-text" href="${id ? `#/plant/${esc(id)}` : '#/'}">Cancel</a>
    <span class="nav-title">${id ? 'Edit plant' : 'New plant'}</span>
    <button class="nav-text strong" type="submit" form="plant-form">Save</button>
  </header>
  <main class="page">
    <form id="plant-form" novalidate>
      <div class="cover-pick">
        <div class="cover-preview" id="cover-preview">${p.coverPhotoId && editing.space ? photoImg(editing.space.id, p.coverPhotoId, 'f') : `<span class="ph-empty">${icon.sprout}</span>`}</div>
        <label class="btn btn-secondary btn-small file-btn">${icon.camera}<span>${p.coverPhotoId ? 'Change photo' : 'Add photo'}</span>
          <input type="file" accept="image/*" name="cover" hidden></label>
      </div>
      <h2 class="section-title">Plant</h2>
      <section class="card fields">
        <label class="field"><span>Name</span><input name="name" type="text" value="${esc(p.name)}" placeholder="e.g. Polka dot begonia" required maxlength="80"></label>
        <label class="field"><span>Type of plant</span><input name="species" type="text" value="${esc(p.species)}" placeholder="e.g. Begonia maculata" maxlength="80"></label>
        <label class="field"><span>Spot (optional)</span><input name="spot" type="text" value="${esc(p.spot)}" placeholder="e.g. Living room window" maxlength="80"></label>
        ${!id && spaces.length > 1 ? `<label class="field"><span>Space</span><select name="space">${spaces.map((s) => `<option value="${esc(s.id)}" ${s.id === defaultSpace ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>`
          : `<input type="hidden" name="space" value="${esc(defaultSpace || '')}">`}
      </section>
      <h2 class="section-title">Watering schedule</h2>
      <section class="card fields">
        <div class="field stepper"><span>Water every</span>
          <div class="stepper-ctl">
            <button type="button" class="step" data-action="step" data-delta="-1" aria-label="Fewer days">&minus;</button>
            <input name="interval" type="number" inputmode="numeric" min="1" max="365" value="${intervalOf(p)}" aria-label="Days between waterings">
            <button type="button" class="step" data-action="step" data-delta="1" aria-label="More days">+</button>
            <span>days</span>
          </div>
        </div>
        ${id ? '' : `
        <label class="field check"><input type="checkbox" name="logWater" checked><span>Record last watering</span></label>
        <label class="field" id="last-watered"><span>Last watered</span><input name="lastWatered" type="date" value="${todayStr()}" max="${todayStr()}"></label>`}
      </section>
      <h2 class="section-title">Care instructions</h2>
      <section class="card fields">
        <label class="field"><span class="sr-only">Care instructions</span><textarea name="notes" rows="4" placeholder="Light, humidity, soil, anything to remember" maxlength="4000">${esc(p.notes)}</textarea></label>
      </section>
      <p class="form-error" role="alert" hidden></p>
    </form>
  </main>`;
}

function viewSettings() {
  const t = theme;
  const spaces = state.spaces;
  const last = state.lastSync ? new Date(state.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'not yet';
  return `
  <header class="navbar">
    <button class="icon-btn" data-action="go" data-to="#/" aria-label="Back">${icon.back}</button>
    <span class="nav-title">Settings</span><span></span>
  </header>
  <main class="page">
    ${banners()}
    <h2 class="section-title">Appearance</h2>
    <section class="card pad">
      <div class="segmented mode-picker" role="radiogroup" aria-label="Appearance">
        ${MODES.map((m) => `<label><input type="radio" name="mode" value="${m.id}" data-action="mode" ${(t.mode || 'auto') === m.id ? 'checked' : ''}><span>${m.label}</span></label>`).join('')}
      </div>
      <div class="presets">${PRESETS.map((p, i) => `
        <button class="preset" data-action="preset" data-index="${i}" aria-label="${esc(p.name)} theme">
          <span class="swatch" style="background:${p.background || '#f2f2f7'}"><span style="background:${p.button}"></span><i style="background:${p.accent}"></i></span>
          <small>${esc(p.name)}</small>
        </button>`).join('')}</div>
      <label class="color-row"><span>Accent (links, highlights)</span><input type="color" data-action="color" data-key="accent" value="${esc(t.accent)}"></label>
      <label class="color-row"><span>Care buttons</span><input type="color" data-action="color" data-key="button" value="${esc(t.button)}"></label>
      <label class="color-row"><span>Custom background</span><input type="checkbox" class="switch" data-action="toggle-bg" ${t.useBackground ? 'checked' : ''}></label>
      ${t.useBackground ? `<label class="color-row"><span>Background</span><input type="color" data-action="color" data-key="background" value="${esc(t.background)}"></label>` : ''}
      <p class="hint">Automatic follows your iPhone's Light or Dark setting. The custom background is used whenever the app is light; dark appearance keeps a dark background so text stays readable.</p>
      <div class="preview"><span class="btn btn-care wide"><span class="ci water">${icon.drop}</span>Water</span><span class="link">Log a different date</span></div>
      <button class="link" data-action="reset-theme">Reset to default</button>
    </section>

    <h2 class="section-title">Spaces</h2>
    <section class="card">
      <ul class="kv-list">${spaces.map((s) => `
        <li><a class="kv link-row" href="#/space/${esc(s.id)}">
          <span class="care-icon cal">${s.locked ? icon.lock : icon.people}</span>
          <span class="kv-label">${esc(s.locked ? 'Locked space' : s.name)}<small>${s.locked ? 'Unlock to see details' : `${plural(s.plants.length, 'plant')} &middot; ${plural(s.members.length, 'member')}${s.role === 'owner' ? ' &middot; owner' : ''}`}</small></span>
          <span class="kv-value">${icon.chevron}</span></a></li>`).join('')}
      </ul>
      <button class="row-btn" data-action="new-space" data-default="">${icon.plus}<span>New space</span></button>
      <button class="row-btn" data-action="join-space">${icon.people}<span>Join with invite code</span></button>
    </section>

    <h2 class="section-title">Backup</h2>
    <section class="card">
      <button class="row-btn" data-action="export">${icon.share}<span>Export backup<small>One encrypted file. Save it to iCloud Drive or Google Drive.</small></span></button>
      <label class="row-btn file-btn">${icon.refresh}<span>Restore from backup<small>Restores into a new space. Needs the passphrase used at backup time.</small></span>
        <input type="file" accept=".json,application/json" data-action="restore" hidden></label>
    </section>

    <h2 class="section-title">Sync</h2>
    <section class="card pad">
      <p>${state.connection === 'ok' ? 'Connected' : state.connection === 'offline' ? 'Offline' : 'Database unreachable'}. Last synced: ${esc(last)}.${state.pending ? ` ${plural(state.pending, 'change')} waiting to upload.` : ''}</p>
      <button class="btn btn-secondary btn-small" data-action="sync">${icon.refresh}Sync now</button>
    </section>

    <h2 class="section-title">Account</h2>
    <section class="card pad">
      <p class="muted">Signed in as ${esc(state.user?.email || '')}</p>
      <button class="btn btn-secondary btn-small" data-action="sign-out">Sign out</button>
    </section>

    <p class="about">${APP_NAME} ${APP_VERSION} &middot; MIT License &middot; <a href="${SOURCE_URL}" target="_blank" rel="noopener">Source code</a><br>
    Your plants, notes, photos and names are encrypted on your phone before upload.</p>
  </main>`;
}

function viewSpace(id) {
  const s = state.spaces.find((x) => x.id === id);
  if (!s) return `<header class="navbar"><button class="icon-btn" data-action="go" data-to="#/settings" aria-label="Back">${icon.back}</button><span></span><span></span></header><main class="page"><p class="muted">Space not found.</p></main>`;
  const owner = s.role === 'owner';
  const me = D.myId();
  if (s.locked) {
    return `
    <header class="navbar"><button class="icon-btn" data-action="go" data-to="#/settings" aria-label="Back">${icon.back}</button><span class="nav-title">Locked space</span><span></span></header>
    <main class="page">
      <section class="card pad"><p>This space is locked on this phone.</p>
        <button class="btn btn-primary btn-block" data-action="unlock" data-space="${esc(s.id)}">Unlock</button></section>
      <section class="card"><button class="row-btn danger" data-action="leave-space" data-space="${esc(s.id)}">${icon.trash}<span>Leave this space</span></button></section>
    </main>`;
  }
  return `
  <header class="navbar">
    <button class="icon-btn" data-action="go" data-to="#/settings" aria-label="Back">${icon.back}</button>
    <span class="nav-title">${esc(s.name)}</span><span></span>
  </header>
  <main class="page">
    ${banners()}
    <h2 class="section-title">Space</h2>
    <section class="card">
      ${owner ? `<button class="row-btn" data-action="rename-space" data-space="${esc(s.id)}">${icon.sprout}<span>Rename<small>${esc(s.name)}</small></span></button>` : ''}
      <button class="row-btn" data-action="my-name" data-space="${esc(s.id)}">${icon.people}<span>Your name here<small>${esc(D.myName(s.id))}, shown as "Watered by ${esc(D.myName(s.id))}"</small></span></button>
    </section>

    <h2 class="section-title">Members</h2>
    <section class="card">
      <ul class="kv-list">${s.members.map((m) => `
        <li class="kv"><span class="care-icon cal">${icon.people}</span>
          <span class="kv-label">${esc(m.displayName)}${m.userId === me ? ' (you)' : ''}<small>${m.role === 'owner' ? 'Owner' : 'Member'}</small></span>
          ${owner && m.userId !== me ? `<button class="link danger" data-action="remove-member" data-space="${esc(s.id)}" data-user="${esc(m.userId)}" data-name="${esc(m.displayName)}">Remove</button>` : '<span></span>'}
        </li>`).join('')}</ul>
      <button class="row-btn" data-action="invite" data-space="${esc(s.id)}">${icon.plus}<span>Invite someone<small>Creates a one-time code, valid for 7 days</small></span></button>
    </section>

    <h2 class="section-title">Security</h2>
    <section class="card">
      ${owner ? `<button class="row-btn" data-action="change-pass" data-space="${esc(s.id)}">${icon.lock}<span>Change passphrase<small>Tell other members the new one. Their phones stay unlocked.</small></span></button>` : ''}
      <button class="row-btn" data-action="lock-space" data-space="${esc(s.id)}">${icon.lock}<span>Lock on this phone<small>You will need the passphrase to open it again</small></span></button>
    </section>

    <section class="card">
      ${owner
        ? `<button class="row-btn danger" data-action="delete-space" data-space="${esc(s.id)}">${icon.trash}<span>Delete space<small>Removes all its plants and photos for everyone</small></span></button>`
        : `<button class="row-btn danger" data-action="leave-space" data-space="${esc(s.id)}">${icon.trash}<span>Leave space</span></button>`}
    </section>
  </main>`;
}

// ---------- Rendering ----------

const FORM_VIEWS = new Set(['edit', 'new', 'auth', 'recovery']);
let currentView = '';

export function render(force = false) {
  let r = route();
  let viewName;
  let html;
  if (!state.ready) {
    viewName = 'loading';
    html = viewLoading();
  } else if (state.recovery && state.user) {
    viewName = 'recovery';
    html = viewRecovery();
  } else if (!state.user) {
    viewName = 'auth';
    html = viewAuth();
  } else if (!state.spaces.length) {
    viewName = state.syncing && !state.lastSync ? 'loading' : 'onboarding';
    html = viewName === 'loading' ? viewLoading() : viewOnboarding();
  } else {
    if ((r.name === 'new' || r.name === 'edit') && !unlockedSpaces().length) r = { name: 'home' };
    viewName = r.name;
    html = {
      home: () => viewHome(),
      plant: () => viewPlant(r.id),
      edit: () => viewForm(r.id),
      new: () => viewForm(null),
      settings: () => viewSettings(),
      space: () => viewSpace(r.id),
    }[r.name]();
  }
  const key = `${viewName}:${r.id || ''}:${state.user?.id || ''}:${authMode}`;
  // Don't wipe a half-filled form because a background sync finished.
  if (!force && key === lastRouteKey && FORM_VIEWS.has(viewName)) return;
  const sameScreen = key === lastRouteKey;
  const scroll = window.scrollY;
  currentView = viewName;
  lastRouteKey = key;
  root.innerHTML = html;
  hydratePhotos();
  bindForms(viewName, r);
  if (sameScreen) window.scrollTo(0, scroll);
  else window.scrollTo(0, 0);
}

// ---------- Form bindings ----------

function showFormError(form, e) {
  const err = form.querySelector('.form-error');
  err.textContent = typeof e === 'string' ? e : D.friendlyError(e);
  err.hidden = false;
}

function bindForms(viewName, r) {
  if (viewName === 'auth') {
    const form = document.getElementById('auth-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      const email = form.email.value.trim();
      const password = form.password ? form.password.value : '';
      if (!email) return showFormError(form, 'Enter your email.');
      if (authMode !== 'reset' && password.length < 8) return showFormError(form, 'Use a password of at least 8 characters.');
      btn.disabled = true;
      try {
        if (authMode === 'signup') {
          const { needsConfirmation } = await D.signUp(email, password);
          if (needsConfirmation) {
            authMode = 'signin';
            render(true);
            await dialog(`<h2>Check your email</h2><p>We sent a confirmation link to <strong>${esc(email)}</strong>. Open it, then come back here and sign in.</p>
              <p class="muted">The link may open in Safari. That's fine: it only confirms your email.</p>
              <div class="dialog-actions"><button class="btn btn-primary" data-close="true">OK</button></div>`);
          }
        } else if (authMode === 'reset') {
          await D.sendPasswordReset(email);
          authMode = 'signin';
          render(true);
          toast('Reset link sent. Check your email.');
        } else {
          await D.signIn(email, password);
        }
      } catch (ex) {
        btn.disabled = false;
        showFormError(form, /invalid login/i.test(ex.message || '') ? 'Email or password is not correct.' : ex);
      }
    });
  }
  if (viewName === 'recovery') {
    const form = document.getElementById('recovery-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (form.password.value.length < 8) return showFormError(form, 'Use at least 8 characters.');
      try {
        await D.setNewPassword(form.password.value);
        toast('Password saved.');
        render(true);
      } catch (ex) {
        showFormError(form, ex);
      }
    });
  }
  if (viewName === 'new' || viewName === 'edit') bindPlantForm(r.id || null);
}

function bindPlantForm(id) {
  const form = document.getElementById('plant-form');
  let coverFile = null;
  form.cover.addEventListener('change', () => {
    const f = form.cover.files[0];
    if (!f) return;
    coverFile = f;
    const url = URL.createObjectURL(f);
    document.getElementById('cover-preview').innerHTML = `<img src="${url}" alt="" class="loaded">`;
  });
  const logWater = form.logWater;
  if (logWater) {
    logWater.addEventListener('change', () => {
      document.getElementById('last-watered').hidden = !logWater.checked;
    });
  }
  let saving = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving) return;
    const name = form.name.value.trim();
    if (!name) return showFormError(form, 'Give your plant a name.');
    const interval = Math.round(Number(form.interval.value));
    if (!(interval >= 1 && interval <= 365)) return showFormError(form, 'Watering interval must be between 1 and 365 days.');
    const spaceId = form.space.value;
    if (!spaceId || !D.isUnlocked(spaceId)) return showFormError(form, 'Choose a space.');
    const lastWatered = logWater && logWater.checked ? form.lastWatered.value : null;
    if (lastWatered && !isValidDay(lastWatered)) return showFormError(form, 'Pick the date of the last watering.');
    saving = true;
    document.querySelector('button[form=plant-form]').disabled = true;
    try {
      const fields = {
        name, species: form.species.value.trim(), spot: form.spot.value.trim(),
        notes: form.notes.value.trim(), intervalDays: interval,
      };
      const newId = await D.savePlant(spaceId, id, fields, { coverFile, lastWatered });
      lastRouteKey = '';
      go(`#/plant/${newId}`);
      toast(id ? 'Saved.' : 'Plant added.');
    } catch (ex) {
      saving = false;
      document.querySelector('button[form=plant-form]').disabled = false;
      showFormError(form, ex);
    }
  });
}

// ---------- Actions ----------

async function askUnlock(spaceId) {
  const s = state.spaces.find((x) => x.id === spaceId);
  if (!s) return;
  const needName = s.needsProfile;
  await formDialog('Unlock space',
    `${passField('pass', 'Space passphrase')}
     ${needName ? textField('name', 'Your name (shown to others in this space)', D.defaultName(), 'autocomplete="given-name" required maxlength="40"') : ''}`,
    'Unlock',
    async (form) => {
      if (needName && !form.name.value.trim()) throw new Error('Enter your name.');
      await D.unlockSpace(spaceId, form.pass.value, needName ? form.name.value.trim() : null);
    },
    { intro: '<p class="muted">This takes a second while the key is checked. You only do this once per phone.</p>' });
}

async function newSpaceFlow(defaultName) {
  const created = await formDialog('New space',
    `${textField('name', 'Space name', defaultName || '', 'required maxlength="40" placeholder="e.g. Home or Work"')}
     ${textField('me', 'Your name (shown as "Watered by ...")', D.defaultName(), 'autocomplete="given-name" required maxlength="40"')}
     ${passField('pass', 'Passphrase', 'new-password')}
     ${passField('pass2', 'Passphrase again', 'new-password')}`,
    'Create',
    async (form) => {
      const name = form.name.value.trim();
      const me = form.me.value.trim();
      if (!name) throw new Error('Name the space.');
      if (!me) throw new Error('Enter your name.');
      checkNewPassphrase(form.pass.value, form.pass2.value);
      return D.createSpace(name, form.pass.value, me);
    },
    { intro: `<p class="muted">The passphrase locks this space's plants and photos. Share it only in person with people you invite. <strong>If everyone forgets it, the data cannot be recovered</strong>, so save it in your password manager.</p>` });
  if (created) {
    setFilter(created);
    try { localStorage.setItem('fk.spaceTip', '1'); } catch { /* ignore */ }
    toast('Space created.');
    go('#/');
  }
}

async function joinFlow() {
  const spaceId = await formDialog('Join a space',
    textField('code', 'Invite code', '', 'autocapitalize="characters" autocomplete="off" required maxlength="20" placeholder="e.g. 3F9A1C27B0"'),
    'Join',
    async (form) => {
      if (!form.code.value.trim()) throw new Error('Enter the code.');
      return D.joinSpace(form.code.value.trim());
    });
  if (spaceId) {
    setFilter(spaceId);
    go('#/');
    await askUnlock(spaceId);
  }
}

async function logOtherDate(plantId) {
  const { plant } = findPlant(plantId);
  if (!plant) return;
  await formDialog('Log a different date',
    `<div class="segmented" role="radiogroup">
      ${Object.entries(CARE_TYPES).map(([k, v], i) => `<label><input type="radio" name="type" value="${k}" ${i === 0 ? 'checked' : ''}><span>${v.action}</span></label>`).join('')}
     </div>
     <label class="field"><span>Date</span><input type="date" name="date" value="${todayStr()}" max="${todayStr()}" required></label>`,
    'Save',
    async (form) => {
      if (!isValidDay(form.date.value)) throw new Error('Pick a date.');
      await D.logCare(plant, form.type.value, form.date.value);
    });
}

async function viewPhotoFlow(photoId, plantId) {
  const { plant, space } = findPlant(plantId);
  const photo = space?.photos.find((p) => p.id === photoId);
  if (!photo) return;
  const action = await dialog(`
    <div class="photo-full"><img alt="" data-full></div>
    <label class="field"><span>Photo date</span><input type="date" name="date" value="${esc(photo.date)}" max="${todayStr()}"></label>
    <div class="dialog-actions wrap">
      <button class="btn btn-secondary" data-act="cover">Use as cover</button>
      <button class="btn btn-danger" data-act="delete">Delete</button>
      <button class="btn btn-primary" data-act="done">Done</button>
    </div>`, {
    onReady: (dlg, close) => {
      D.photoURL(space.id, photo.id, 'f').then((url) => { dlg.querySelector('[data-full]').src = url; }).catch(() => {});
      dlg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (b) close({ act: b.dataset.act, date: dlg.querySelector('input[name=date]').value });
      });
    },
  });
  if (!action) return;
  if (isValidDay(action.date) && action.date !== photo.date && action.act !== 'delete') {
    await D.updatePhoto(photo, { date: action.date });
  }
  if (action.act === 'cover') {
    await D.setCoverPhoto(plant, photo.id);
    toast('Cover photo updated.');
  } else if (action.act === 'delete') {
    if (await confirmDialog('Delete this photo?', 'It will be removed for everyone in this space.', 'Delete', true)) {
      await D.deletePhoto(photo);
      toast('Photo deleted.');
    }
  }
}

async function inviteFlow(spaceId) {
  const s = state.spaces.find((x) => x.id === spaceId);
  let code;
  try {
    code = await D.createInvite(spaceId);
  } catch (e) {
    toast(D.friendlyError(e));
    return;
  }
  const appUrl = location.origin + location.pathname;
  const message = `Join my plant space "${s.name}" in ${APP_NAME}: open ${appUrl} on your iPhone, add it to your Home Screen, create an account, then choose "Enter invite code" and type ${code}. I'll tell you the passphrase in person.`;
  await dialog(`
    <h2>Invite code</h2>
    <p class="invite-code">${esc(code)}</p>
    <p class="muted">Valid for 7 days, for one person. Send the code any way you like, but share the <strong>passphrase</strong> only in person or by voice.</p>
    <div class="dialog-actions wrap">
      <button class="btn btn-secondary" data-share>${icon.share}Share invite</button>
      <button class="btn btn-primary" data-close="true">Done</button>
    </div>`, {
    onReady: (dlg) => {
      dlg.querySelector('[data-share]').addEventListener('click', async () => {
        try {
          if (navigator.share) await navigator.share({ text: message });
          else {
            await navigator.clipboard.writeText(message);
            toast('Invite copied.');
          }
        } catch { /* cancelled */ }
      });
    },
  });
}

async function exportFlow() {
  toast('Preparing backup...');
  try {
    const result = await exportBackup((done, total) => {
      if (total) toast(`Preparing backup... ${done} of ${total} photos`);
    });
    const how = await saveFile(result.file);
    if (how === 'cancelled') return;
    await dialog(`<h2>Backup ready</h2>
      <p>${plural(result.spaces, 'space')}, ${plural(result.plants, 'plant')} and ${plural(result.photos, 'photo')}.</p>
      ${result.missing ? `<p class="form-error">${plural(result.missing, 'photo')} could not be included (not downloaded and offline).</p>` : ''}
      <p class="muted">${how === 'shared' ? 'Choose "Save to Files" and pick iCloud Drive or Google Drive.' : 'The file was downloaded. On iPhone it is in Files, under Downloads.'}
      To restore it later you need the passphrase each space had when you made this backup.</p>
      <div class="dialog-actions"><button class="btn btn-primary" data-close="true">OK</button></div>`);
  } catch (e) {
    toast(D.friendlyError(e));
  }
}

async function restoreFlow(file) {
  let backup;
  try {
    backup = await readBackupFile(file);
  } catch (e) {
    toast(e.message);
    return;
  }
  const when = backup.createdAt ? new Date(backup.createdAt).toLocaleDateString() : 'unknown date';
  for (let i = 0; i < backup.sections.length; i++) {
    const section = backup.sections[i];
    const result = await formDialog(`Restore space ${i + 1} of ${backup.sections.length}`,
      `${passField('pass', 'Passphrase for this space (at backup time)')}
       ${textField('me', 'Your name', D.defaultName(), 'required maxlength="40"')}
       <p class="hint" data-progress></p>`,
      'Restore',
      async (form) => {
        if (!form.me.value.trim()) throw new Error('Enter your name.');
        const progress = form.querySelector('[data-progress]');
        return restoreSection(section, form.pass.value, form.me.value.trim(), (d, t) => {
          progress.textContent = `Uploading ${d} of ${t}...`;
        });
      },
      { intro: `<p class="muted">Backup from ${esc(when)}. It will be restored as a new space, so nothing current is overwritten.</p>` });
    if (result) toast(`Restored "${result.name}" with ${plural(result.plants, 'plant')}.`);
  }
}

function setTheme(next) {
  theme = next;
  saveTheme(theme);
  applyTheme(theme);
}

const actions = {
  go: (el) => go(el.dataset.to),
  sync: () => D.sync(),
  'dismiss-notice': () => D.setNotice(null),
  'auth-mode': (el) => { authMode = el.dataset.mode; render(true); },
  'sign-out': async () => {
    const msg = state.pending
      ? `${plural(state.pending, 'change')} have not uploaded yet and will be lost. This phone will also forget your space keys.`
      : 'This phone will forget your space keys. You will need the passphrases to unlock them again.';
    if (await confirmDialog('Sign out?', msg, 'Sign out', true)) {
      await D.signOut();
      location.hash = '#/';
    }
  },
  filter: (el) => { setFilter(el.dataset.space); render(true); },
  'hide-install': () => { localStorage.setItem('fk.installHint', '1'); render(true); },
  'hide-space-tip': () => { localStorage.setItem('fk.spaceTip', '1'); render(true); },
  'add-plant': () => go('#/new'),
  'new-space': (el) => newSpaceFlow(el.dataset.default),
  'join-space': () => joinFlow(),
  unlock: (el) => askUnlock(el.dataset.space),
  'quick-water': async (el) => {
    const { plant } = findPlant(el.dataset.plant);
    if (!plant) return;
    el.classList.add('pop');
    await D.logCare(plant, 'water');
    const { space } = findPlant(plant.id);
    const newest = sortEventsNewestFirst(eventsFor(space, plant.id)).find((e) => e.type === 'water');
    toast(`Watered ${plant.name}.`, 'Undo', () => newest && D.deleteEvent(newest));
  },
  log: async (el) => {
    const { plant } = findPlant(el.dataset.plant);
    if (!plant) return;
    const type = el.dataset.type;
    await D.logCare(plant, type);
    const { space } = findPlant(plant.id);
    const newest = sortEventsNewestFirst(eventsFor(space, plant.id)).find((e) => e.type === type);
    toast(`${CARE_TYPES[type].past} today.`, 'Undo', () => newest && D.deleteEvent(newest));
  },
  'log-other': (el) => logOtherDate(el.dataset.plant),
  'view-photo': (el) => viewPhotoFlow(el.dataset.photoId, el.dataset.plant),
  'event-menu': async (el) => {
    const { space } = findPlant(el.dataset.plant);
    const ev = space?.events.find((e) => e.id === el.dataset.event);
    if (!ev) return;
    if (await confirmDialog('Remove this entry?', `${CARE_TYPES[ev.type]?.past || ''} on ${formatDay(ev.date)}${ev.by ? ` by ${ev.by}` : ''}`, 'Remove', true)) {
      await D.deleteEvent(ev);
    }
  },
  'delete-plant': async (el) => {
    const { plant } = findPlant(el.dataset.plant);
    if (!plant) return;
    if (await confirmDialog(`Delete ${plant.name}?`, 'This removes the plant, its photos and its care history for everyone in this space.', 'Delete', true)) {
      await D.deletePlant(plant);
      go('#/');
      toast('Plant deleted.');
    }
  },
  step: (el) => {
    const input = document.querySelector('input[name=interval]');
    const v = Math.min(365, Math.max(1, (Math.round(Number(input.value)) || 7) + Number(el.dataset.delta)));
    input.value = v;
  },
  preset: (el) => { setTheme(fromPreset(PRESETS[Number(el.dataset.index)], theme.mode)); render(true); },
  'toggle-bg': (el) => { setTheme({ ...theme, useBackground: el.checked }); render(true); },
  'reset-theme': () => { setTheme({ ...defaultTheme(), mode: theme.mode }); render(true); },
  export: () => exportFlow(),
  'rename-space': async (el) => {
    const s = state.spaces.find((x) => x.id === el.dataset.space);
    await formDialog('Rename space', textField('name', 'Name', s.name, 'required maxlength="40"'), 'Save', async (form) => {
      if (!form.name.value.trim()) throw new Error('Enter a name.');
      await D.renameSpace(s.id, form.name.value.trim());
    });
  },
  'my-name': async (el) => {
    const id = el.dataset.space;
    await formDialog('Your name', textField('name', 'Shown as "Watered by ..."', D.myName(id), 'required maxlength="40"'), 'Save', async (form) => {
      if (!form.name.value.trim()) throw new Error('Enter a name.');
      await D.setDisplayName(id, form.name.value.trim());
    }, { intro: '<p class="muted">New entries use the new name. Earlier entries keep the name they were logged with.</p>' });
  },
  invite: (el) => inviteFlow(el.dataset.space),
  'remove-member': async (el) => {
    if (await confirmDialog(`Remove ${el.dataset.name}?`, 'They will lose access to this space. Consider changing the passphrase afterwards.', 'Remove', true)) {
      try { await D.removeMember(el.dataset.space, el.dataset.user); toast('Removed.'); } catch (e) { toast(D.friendlyError(e)); }
    }
  },
  'change-pass': async (el) => {
    const id = el.dataset.space;
    const ok = await formDialog('Change passphrase',
      `${passField('old', 'Current passphrase', 'current-password')}${passField('pass', 'New passphrase', 'new-password')}${passField('pass2', 'New passphrase again', 'new-password')}`,
      'Change', async (form) => {
        checkNewPassphrase(form.pass.value, form.pass2.value);
        await D.changePassphrase(id, form.old.value, form.pass.value);
      }, { intro: '<p class="muted">Old backups still open with the old passphrase. Export a new backup afterwards.</p>' });
    if (ok) toast('Passphrase changed.');
  },
  'lock-space': async (el) => {
    if (await confirmDialog('Lock this space on this phone?', 'You will need the passphrase to unlock it again.', 'Lock')) {
      await D.lockSpace(el.dataset.space);
      go('#/settings');
    }
  },
  'leave-space': async (el) => {
    if (await confirmDialog('Leave this space?', 'You will need a new invite to join again.', 'Leave', true)) {
      try { await D.leaveSpace(el.dataset.space); setFilter('all'); go('#/'); } catch (e) { toast(D.friendlyError(e)); }
    }
  },
  'delete-space': async (el) => {
    const s = state.spaces.find((x) => x.id === el.dataset.space);
    const ok = await formDialog(`Delete ${s.name}?`,
      textField('confirm', `Type "${s.name}" to confirm`, '', 'autocomplete="off" required'),
      'Delete forever', async (form) => {
        if (form.confirm.value.trim() !== s.name) throw new Error('The name does not match.');
        await D.deleteSpace(s.id);
      }, { intro: '<p class="form-error">This removes every plant, log and photo in this space, for everyone. Export a backup first if unsure.</p>' });
    if (ok) { setFilter('all'); go('#/'); toast('Space deleted.'); }
  },
};

const changeActions = {
  mode: (el) => { setTheme({ ...theme, mode: el.value }); },
  color: (el) => { setTheme({ ...theme, [el.dataset.key]: el.value }); },
  'add-progress': async (el) => {
    const f = el.files[0];
    el.value = '';
    if (!f) return;
    const { plant } = findPlant(el.dataset.plant);
    try {
      toast('Adding photo...');
      await D.addProgressPhoto(plant, f);
      toast('Photo added.');
    } catch (e) {
      toast(D.friendlyError(e));
    }
  },
  restore: async (el) => {
    const f = el.files[0];
    el.value = '';
    if (f) await restoreFlow(f);
  },
};

export function start() {
  applyTheme(theme);
  root.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'INPUT') return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    e.preventDefault();
    try {
      await fn(el, e);
    } catch (ex) {
      console.error(ex);
      toast(D.friendlyError(ex));
    }
  });
  root.addEventListener('change', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'toggle-bg') return actions['toggle-bg'](el);
    const fn = changeActions[el.dataset.action];
    if (fn) {
      try { await fn(el, e); } catch (ex) { toast(D.friendlyError(ex)); }
    }
  });
  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-action="color"]');
    if (el) changeActions.color(el);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(theme));
  window.addEventListener('hashchange', () => render(true));
  D.subscribe(() => render(false));
  render(true);
}
