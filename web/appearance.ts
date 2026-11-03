export type Appearance = 'light' | 'dark' | 'system';
const key = 'staf-appearance';

export function readAppearance(): Appearance {
  try {
    const saved = localStorage.getItem(key);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch { return 'system'; }
}

export function applyAppearance(value: Appearance) {
  document.documentElement.dataset.appearance = value;
}

export function saveAppearance(value: Appearance) {
  applyAppearance(value);
  try { localStorage.setItem(key, value); } catch { /* Apply for this page even if storage is unavailable. */ }
}
