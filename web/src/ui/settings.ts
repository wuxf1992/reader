import type { ThemeMode } from '../render/theme.ts';
import { PALETTES, clampBrightness } from '../render/theme.ts';

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
