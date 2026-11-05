/**
 * The client's style intervention.
 *
 * This file is the product's core differentiator, so it is worth being explicit
 * about what it does and does not do.
 *
 * ## The rule
 *
 * **The publisher's layout wins.** The client may set defaults only for things
 * the book left unspecified, and may expose values the reader is entitled to
 * control (text size, theme, page width) through variables that a book is free
 * to ignore.
 *
 * Concretely, this stylesheet never sets: `font-family`, `line-height`,
 * `text-align`, `letter-spacing`, `margin` on content elements, `writing-mode`,
 * or anything else a typographer chose. Readium CSS does set them — its premise
 * is that a consistent, controlled reading experience beats fidelity, and that
 * premise is the opposite of this product's.
 *
 * ## How the reader's settings reach the book without overwriting it
 *
 * Through CSS custom properties with fallbacks a book can ship its own value
 * for. `font-size: var(--reader-font-size, 1em)` means: a book that set an
 * explicit size keeps it, and a book that did not inherits the reader's choice.
 * That is the whole mechanism, and it is why `!important` appears nowhere here.
 *
 * ## Root font size, not per-element font sizes
 *
 * Setting `font-size` on the container only affects text that uses relative
 * units. That is deliberate: a book that declares `font-size: 14px` on a
 * paragraph has stated an intent, and the reader's slider has no business
 * overriding it. What the slider changes is the base that everything relative
 * scales from, which is the behaviour a reader expects from a real book app and
 * the only one that can be implemented without fighting the book.
 */

export type ThemeMode = keyof typeof PALETTES;

export const MIN_BRIGHTNESS = 0.5;

export function clampBrightness(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(MIN_BRIGHTNESS, Math.min(1, value)) : 1;
}

/**
 * Theme palettes.
 *
 * Applied as custom properties rather than as rules on the book's elements, so a
 * book that hard-codes `color: #333` keeps it. That is the correct trade: a dark
 * theme that silently defeats a print-oriented book's contrast is a bug report,
 * whereas a book whose text stays dark on a "dark" background is one the reader
 * can see and judge.
 */
export const PALETTES = {
  // Official palettes adapted for readable text and controls: catppuccin.com, rosepinetheme.com, ethanschoonover.com/solarized, nordtheme.com.
  // Flexoki by Steph Ango: https://stephango.com/flexoki; Everforest: https://github.com/sainnhe/everforest.
  light: { label: '素白', name: '清爽纸页', scheme: 'light', background: '#fbfaf7', text: '#1a1a1a', muted: '#6b6b6b', surface: '#ffffff', line: '#e3e0da', accent: '#7a5c3e', onAccent: '#ffffff' },
  'parchment-day': { label: '羊皮纸', name: 'Parchment', scheme: 'light', background: '#e3d4ad', text: '#403722', muted: '#5b4c32', surface: '#e9dcbc', line: '#c3b38c', accent: '#645334', onAccent: '#fff9e8' },
  'kraft-day': { label: '牛皮纸', name: 'Kraft Paper', scheme: 'light', background: '#d9c29b', text: '#24180e', muted: '#281b10', surface: '#e6d1b0', line: '#b49b73', accent: '#664324', onAccent: '#fff6e7' },
  'flexoki-day': { label: '墨纸', name: 'Flexoki Light', scheme: 'light', background: '#fffcf0', text: '#100f0f', muted: '#575653', surface: '#f2f0e5', line: '#cecdc3', accent: '#1c6c66', onAccent: '#ffffff' },
  'everforest-day': { label: '森间晨光', name: 'Everforest Light', scheme: 'light', background: '#f3f5d9', text: '#5c6a72', muted: '#5f6a5d', surface: '#f8f5e4', line: '#bec5b2', accent: '#52662a', onAccent: '#ffffff' },
  'catppuccin-latte-day': { label: '晨雾拿铁', name: 'Catppuccin Latte', scheme: 'light', background: '#eff1f5', text: '#4c4f69', muted: '#626780', surface: '#e6e9ef', line: '#bcc0cc', accent: '#8234e3', onAccent: '#ffffff' },
  'rose-pine-dawn-day': { label: '玫瑰晨光', name: 'Rosé Pine Dawn', scheme: 'light', background: '#faf4ed', text: '#575279', muted: '#6e6a86', surface: '#fffaf3', line: '#dfdad9', accent: '#286983', onAccent: '#ffffff' },
  'solarized-day': { label: '暖砂纸页', name: 'Solarized Light', scheme: 'light', background: '#fdf6e3', text: '#4a6068', muted: '#53686e', surface: '#eee8d5', line: '#cfc8b4', accent: '#006d80', onAccent: '#ffffff' },
  sepia: { label: '米黄', name: '温润书卷', scheme: 'light', background: '#f5ecd9', text: '#3b3327', muted: '#776750', surface: '#f9f3e4', line: '#e0d3ba', accent: '#7a5c3e', onAccent: '#ffffff' },
  green: { label: '浅绿', name: '林间书页', scheme: 'light', background: '#d5ecd7', text: '#23392c', muted: '#526b56', surface: '#e8f2e8', line: '#bdd6bf', accent: '#3d6847', onAccent: '#ffffff' },
  'wechat-day': { label: '微信日间', name: '简洁灰白', scheme: 'light', background: '#f4f5f7', text: '#1a1a1a', muted: '#646b75', surface: '#ffffff', line: '#dce0e5', accent: '#146bbc', onAccent: '#ffffff' },
  'houmo-day': { label: '厚墨日间', name: '暖纸墨香', scheme: 'light', background: '#f9f2e8', text: '#404048', muted: '#746d64', surface: '#f9f2e8', line: '#ded5c9', accent: '#404048', onAccent: '#ffffff' },
  dark: { label: '静夜', name: '柔和深灰', scheme: 'dark', background: '#16171a', text: '#d8d4cc', muted: '#9a958c', surface: '#1e2024', line: '#33363b', accent: '#b39272', onAccent: '#111111' },
  'flexoki-night': { label: '夜墨', name: 'Flexoki Dark', scheme: 'dark', background: '#100f0f', text: '#cecdc3', muted: '#9f9d96', surface: '#1c1b1a', line: '#403e3c', accent: '#3aa99f', onAccent: '#100f0f' },
  'everforest-night': { label: '森林暮色', name: 'Everforest Dark', scheme: 'dark', background: '#2d353b', text: '#d3c6aa', muted: '#a4afa6', surface: '#343f44', line: '#56635f', accent: '#a7c080', onAccent: '#2d353b' },
  'catppuccin-mocha-night': { label: '醇夜摩卡', name: 'Catppuccin Mocha', scheme: 'dark', background: '#1e1e2e', text: '#cdd6f4', muted: '#a6adc8', surface: '#313244', line: '#585b70', accent: '#cba6f7', onAccent: '#1e1e2e' },
  'rose-pine-moon-night': { label: '玫瑰月影', name: 'Rosé Pine Moon', scheme: 'dark', background: '#232136', text: '#e0def4', muted: '#aaa6c0', surface: '#2a273f', line: '#56526e', accent: '#c4a7e7', onAccent: '#232136' },
  'nord-night': { label: '北境极夜', name: 'Nord', scheme: 'dark', background: '#2e3440', text: '#eceff4', muted: '#c2cad8', surface: '#3b4252', line: '#626f86', accent: '#88c0d0', onAccent: '#2e3440' },
  'wechat-night': { label: '微信夜间', name: '纯黑夜读', scheme: 'dark', background: '#000000', text: '#d8d4cc', muted: '#9a9fa8', surface: '#1a1a1a', line: '#33363b', accent: '#3897f1', onAccent: '#111111' },
  'wechat-soft-night': { label: '微信柔灰夜间', name: '柔灰夜读', scheme: 'dark', background: '#1b1b1b', text: '#b6b6b1', muted: '#94948f', surface: '#1f1f1f', line: '#3b3b39', accent: '#b0b0a8', onAccent: '#1b1b1b' },
  'houmo-night': { label: '厚墨夜间', name: '沉静蓝灰', scheme: 'dark', background: '#333949', text: '#e0e3eb', muted: '#afb6c5', surface: '#333949', line: '#555e73', accent: '#00bbca', onAccent: '#111111' },
} satisfies Record<string, { label: string; name: string; scheme: 'light' | 'dark'; background: string; text: string; muted: string; surface: string; line: string; accent: string; onAccent: string }>;
