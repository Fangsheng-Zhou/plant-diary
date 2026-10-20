// Customizable colors, saved on this device.

export const PRESETS = [
  { name: 'Sage', accent: '#34A853', button: '#64845E', background: null },
  { name: 'Ocean', accent: '#1E88E5', button: '#2F6690', background: '#EEF4FA' },
  { name: 'Terracotta', accent: '#C8553D', button: '#B5654A', background: '#FBF3EE' },
  { name: 'Lavender', accent: '#7E57C2', button: '#8E7CC3', background: '#F5F2FB' },
  { name: 'Charcoal', accent: '#4A4A4A', button: '#2F3E46', background: null },
];

const KEY = 'fk.theme';

export function defaultTheme() {
  const p = PRESETS[0];
  return { accent: p.accent, button: p.button, useBackground: false, background: '#F2F2F7' };
}

export function loadTheme() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (t && t.accent && t.button) return { ...defaultTheme(), ...t };
  } catch { /* ignore */ }
  return defaultTheme();
}

export function saveTheme(theme) {
  try { localStorage.setItem(KEY, JSON.stringify(theme)); } catch { /* ignore */ }
}

export function fromPreset(p) {
  return {
    accent: p.accent,
    button: p.button,
    useBackground: Boolean(p.background),
    background: p.background || '#F2F2F7',
  };
}

function isLight(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.65;
}

const safeHex = (v, fallback) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : fallback);

export function applyTheme(theme) {
  const d = defaultTheme();
  const root = document.documentElement;
  const accent = safeHex(theme.accent, d.accent);
  const button = safeHex(theme.button, d.button);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--button', button);
  root.style.setProperty('--button-text', isLight(button) ? '#111111' : '#ffffff');
  if (theme.useBackground) {
    root.style.setProperty('--custom-bg', safeHex(theme.background, d.background));
    root.dataset.customBg = 'true';
  } else {
    root.style.removeProperty('--custom-bg');
    delete root.dataset.customBg;
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme.useBackground ? safeHex(theme.background, d.background) : '#f2f2f7');
}
