export type Theme = 'system' | 'light' | 'dark';
const KEY = 'atlas:theme';

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

/** Apply and remember a theme. "system" follows the device's light/dark setting. */
export function setTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  try {
    if (t === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* storage blocked: the choice lasts for this visit */
  }
  window.dispatchEvent(new Event('atlas-theme'));
}

/** Whether the page is currently dark (for canvas/WebGL views that can't use CSS). */
export const isDark = () => {
  const t = document.documentElement.getAttribute('data-theme');
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
