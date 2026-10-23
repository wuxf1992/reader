/**
 * Reader settings, persisted per device.
 *
 * Deliberately local rather than synced. Font size and theme are properties of
 * the screen the reader is holding — a phone and a tablet want different values —
 * whereas the reading position is a property of the reader. Syncing the first
 * would mean opening a book on the tablet in the phone's font size, which is the
 * one behaviour nobody wants.
 *
 * The palette is mirrored into the reader's own theme module so the shell's
 * chrome and the book's page never disagree about whether the reader chose dark.
 */

import type { ReaderSettings, ThemeMode } from '../render/theme.ts';
import { DEFAULT_SETTINGS, PALETTES, clampBrightness } from '../render/theme.ts';

const KEY = 'reader.settings';

export function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return {
      fontSize: clamp(parsed.fontSize, 12, 32, DEFAULT_SETTINGS.fontSize),
      pageWidth: clamp(parsed.pageWidth, 360, 1200, DEFAULT_SETTINGS.pageWidth),
      columnGap: DEFAULT_SETTINGS.columnGap,
      pagePadding: DEFAULT_SETTINGS.pagePadding,
      theme: isTheme(parsed.theme) ? parsed.theme : DEFAULT_SETTINGS.theme,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: ReaderSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Private browsing modes throw on write. The settings still apply for this
    // session, which is better than failing the interaction.
  }
}

/** Set the theme on the root element, where the shell's own variables live. */
export function applyTheme(root: HTMLElement, theme: ThemeMode): void {
  const palette = PALETTES[theme];
  root.dataset.theme = theme;
  root.style.colorScheme = palette.scheme;
  for (const [key, value] of Object.entries({ ink: palette.text, paper: palette.background,
    surface: palette.surface, muted: palette.muted, line: palette.line, accent: palette.accent, 'on-accent': palette.onAccent })) {
    root.style.setProperty(`--reader-${key}`, value);
  }
  applyBrowserTheme(root, theme);
  try {
    localStorage.setItem('reader.theme-color', palette.background);
    localStorage.setItem('reader.theme-scheme', palette.scheme);
  } catch { /* The theme still works when browser storage is unavailable. */ }
}

export function applyBrowserTheme(root: HTMLElement, theme: ThemeMode, surface: HTMLElement = root): void {
  const palette = PALETTES[theme];
  const brightness = clampBrightness(Number(root.dataset.readerBrightness ?? 1));
  const property = root.dataset.readerChrome === 'visible' ? '--reader-surface' : '--reader-paper';
  const sampled = surface === root ? '' : getComputedStyle(surface).getPropertyValue(property).trim();
  const background = /^#[\da-f]{6}$/i.test(sampled) ? sampled : root.dataset.readerChrome === 'visible' ? palette.surface : palette.background;
  let channels = background.slice(1).match(/../g)!.map(channel => Math.round(parseInt(channel, 16) * brightness));
  if (root.dataset.readerScrim === 'visible') {
    const style = getComputedStyle(root);
    const nativeScrim = surface === root ? null : getComputedStyle(surface).getPropertyValue('--color-scrim').trim().match(/^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
    const storedColor = style.getPropertyValue('--reader-scrim-color').trim();
    const color = /^#[\da-f]{6}$/i.test(storedColor) ? storedColor : '#000000';
    const storedOpacity = nativeScrim ? Number(nativeScrim[4]) : Number.parseFloat(style.getPropertyValue('--reader-scrim-opacity'));
    const opacity = Number.isFinite(storedOpacity) ? Math.max(0, Math.min(1, storedOpacity)) : 0.42;
    const overlay = nativeScrim ? nativeScrim.slice(1, 4).map(Number) : color.slice(1).match(/../g)!.map(channel => parseInt(channel, 16));
    channels = channels.map((channel, index) => Math.round(channel * (1 - opacity) + overlay[index]! * opacity));
  }
  const color = '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('');
  root.style.setProperty('--reader-browser-paper', color);
  // Reading paper can be dark while the app stays light (and brightness dims both bars).
  const luminance = channels.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
  root.style.colorScheme = luminance > 0.179 ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  // The CSS document background shares this color for home-screen Safari's sampling fallback.
  try { localStorage.setItem('reader.browser-color', color); } catch { /* Storage may be disabled. */ }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isTheme(value: unknown): value is ThemeMode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PALETTES, value);
}

export type { ReaderSettings };
