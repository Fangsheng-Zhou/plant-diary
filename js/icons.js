// Simple original line icons (24x24), drawn for Plant Diary.

const svg = (body, { fill = false } = {}) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icon = {
  drop: svg('<path d="M12 3.5c-2.6 3.3-6 7.3-6 10.7a6 6 0 0 0 12 0c0-3.4-3.4-7.4-6-10.7z"/>', { fill: true }),
  repot: svg('<path d="M19.5 10.5A7.5 7.5 0 0 0 6 6.5M4.5 13.5A7.5 7.5 0 0 0 18 17.5"/><path d="M5 3.5v3.5h3.5M19 20.5V17h-3.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  sliders: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  camera: svg('<path d="M4 8.5h3.2L9 6h6l1.8 2.5H20V19H4z"/><circle cx="12" cy="13.2" r="3.4"/>'),
  calendar: svg('<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M9 3.5v4M15 3.5v4"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9.5" rx="2.2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  trash: svg('<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>'),
  share: svg('<path d="M12 15V4M8 8l4-4 4 4"/><path d="M6 12v8h12v-8"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>'),
  people: svg('<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/><circle cx="17" cy="9.5" r="2.4"/><path d="M15.8 14.4c2.3.1 4 1.6 4.6 4.1"/>'),
  sprout: svg('<path d="M12 21v-9"/><path d="M12 12c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5z" fill="currentColor"/><path d="M12 14c0-3.2-2.4-5.2-5.5-5.2 0 3.2 2.4 5.2 5.5 5.2z" fill="currentColor"/>'),
};

export const careIcon = (type) => {
  if (type === 'repot') return `<span class="care-icon repot">${icon.repot}</span>`;
  return `<span class="care-icon water">${icon.drop}</span>`;
};
