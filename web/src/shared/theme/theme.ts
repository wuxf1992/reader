import { PALETTES, type ThemeMode as ReaderPalette } from '../../render/theme.ts';
/**
 * Reader V3.1 themes (docs/prototypes/Reader V3 主题语义令牌.md).
 *
 * A theme is one set of semantic token values. Components only read the tokens
 * (`--color-*`, declared per theme and mode in styles/theme-tokens.css); switching
 * theme switches attributes and semantic tokens:
 *
 *   <html data-theme="warm|blue|green" data-mode="light|dark">
 *   <div class="reader-screen" data-theme="gray" data-mode="…">
 *
 * The values below are the same as the stylesheet's; test/theme-tokens.test.ts keeps
 * the two in step and holds every palette to the spec's contrast pairs.
 */

export const channels = ['read', 'video', 'music', 'audio'] as const;
export type ThemeChannel = typeof channels[number];

export interface ChannelTokens { fill: string; soft: string; text: string }
export interface ThemeTokens {
  bg: string; surface: string; surface2: string; ink: string; muted: string; line: string;
  brand: string; brandSoft: string; onBrand: string; brandText: string; onCh: string; scrim: string;
  ch: Record<ThemeChannel, ChannelTokens>;
}

/** Order of the spec's tables: [fill, soft, text] for read, video, music, audio. */
type ChannelRows = readonly [readonly [string, string, string], readonly [string, string, string], readonly [string, string, string], readonly [string, string, string]];
function palette(
  [bg, surface, surface2, ink, muted, line, brand, brandSoft, onBrand, brandText, onCh, scrim]: readonly string[],
  rows: ChannelRows,
): ThemeTokens {
  const ch = Object.fromEntries(channels.map((name, index) => {
    const [fill, soft, text] = rows[index]!;
    return [name, { fill, soft, text }];
  })) as Record<ThemeChannel, ChannelTokens>;
  return { bg: bg!, surface: surface!, surface2: surface2!, ink: ink!, muted: muted!, line: line!, brand: brand!, brandSoft: brandSoft!, onBrand: onBrand!, brandText: brandText!, onCh: onCh!, scrim: scrim!, ch };
}

export const themes = {
  warm: {
    id: 'warm', name: '暖陶', readingOnly: false,
    light: palette(['#FDF9F6', '#FFFFFF', '#F8EFE8', '#3A2A22', '#82685B', '#F0E3DA', '#F2B79F', '#FBE9E0', '#2B1810', '#A8482A', '#2B1810', 'rgba(58,42,34,.40)'],
      [['#F2B79F', '#FBE9E0', '#A8482A'], ['#F6CA97', '#FCF0DD', '#8A5200'], ['#EFA9A3', '#FAE4E1', '#A8343E'], ['#E6BE9E', '#F7EBDD', '#7A5232']]),
    dark: palette(['#1F1713', '#2A201A', '#352A23', '#F7EDE6', '#BBA79B', '#43342B', '#E88F73', '#3F2A21', '#1A100C', '#F0987C', '#1A100C', 'rgba(0,0,0,.60)'],
      [['#E88F73', '#3F2A21', '#E88F73'], ['#E9AA6E', '#3A2E1E', '#E9AA6E'], ['#E58A8A', '#3D2526', '#E58A8A'], ['#D9A07F', '#36291F', '#D9A07F']]),
  },
  blue: {
    id: 'blue', name: '雾蓝', readingOnly: false,
    light: palette(['#F8FAFE', '#FFFFFF', '#EDF2FA', '#1F3250', '#5A6C8C', '#E4EBF6', '#9DC0F2', '#E6EFFC', '#0F1D36', '#2F63B0', '#0F1D36', 'rgba(31,50,80,.40)'],
      [['#9DC0F2', '#E6EFFC', '#2F63B0'], ['#9FD2EE', '#E3F2FA', '#1F6F93'], ['#B2B8F2', '#ECEEFC', '#4A52B0'], ['#90CBD8', '#E0F2F5', '#1F6F7C']]),
    dark: palette(['#0F1722', '#172131', '#202C40', '#E8EEF7', '#9FB0C8', '#2A3850', '#7FB1F0', '#1C3050', '#0A1220', '#8DB8F0', '#0A1220', 'rgba(0,0,0,.60)'],
      [['#7FB1F0', '#1C3050', '#7FB1F0'], ['#7CC3E8', '#1A3347', '#7CC3E8'], ['#9AA3F0', '#25274D', '#9AA3F0'], ['#70C1CF', '#17353A', '#70C1CF']]),
  },
  green: {
    id: 'green', name: '青绿', readingOnly: false,
    light: palette(['#F7FBF8', '#FFFFFF', '#EAF4EE', '#1B3329', '#52705F', '#E0EEE5', '#8AD6B1', '#E1F4EA', '#0F2A1E', '#1F6B4F', '#0F2A1E', 'rgba(27,51,41,.40)'],
      [['#8AD6B1', '#E1F4EA', '#1F6B4F'], ['#A9DB9B', '#EBF6E2', '#3F6E1F'], ['#8CD2CF', '#E1F3F2', '#1F6B68'], ['#B6D98E', '#F0F5E0', '#5B6B1F']]),
    dark: palette(['#0E1914', '#15251E', '#1E3229', '#E6F2EC', '#98B3A7', '#28403A', '#6ED6A8', '#1A3B2E', '#07130E', '#7FDDB4', '#07130E', 'rgba(0,0,0,.60)'],
      [['#6ED6A8', '#1A3B2E', '#6ED6A8'], ['#8ED67A', '#243A1E', '#8ED67A'], ['#6CCBC6', '#173A38', '#6CCBC6'], ['#A6CF72', '#2C3818', '#A6CF72']]),
  },
  gray: {
    id: 'gray', name: '黑白灰', readingOnly: false,
    light: palette(['#F5F5F5', '#FFFFFF', '#EBEBEB', '#1A1A1A', '#666666', '#E0E0E0', '#3D3D3D', '#EDEDED', '#FFFFFF', '#3D3D3D', '#FFFFFF', 'rgba(26,26,26,.40)'],
      [['#3D3D3D', '#EDEDED', '#3D3D3D'], ['#4A4A4A', '#EDEDED', '#4A4A4A'], ['#575757', '#EDEDED', '#575757'], ['#666666', '#EDEDED', '#666666']]),
    dark: palette(['#121212', '#1B1B1B', '#262626', '#E6E6E6', '#9E9E9E', '#2E2E2E', '#E6E6E6', '#2A2A2A', '#121212', '#E6E6E6', '#121212', 'rgba(0,0,0,.60)'],
      [['#CFCFCF', '#2A2A2A', '#CFCFCF'], ['#BDBDBD', '#2A2A2A', '#BDBDBD'], ['#ABABAB', '#2A2A2A', '#ABABAB'], ['#999999', '#2A2A2A', '#999999']]),
  },
} as const satisfies Record<string, { id: string; name: string; readingOnly: boolean; light: ThemeTokens; dark: ThemeTokens }>;

export type ThemeId = keyof typeof themes;
export type AppThemeId = ThemeId | ReadingPreset;
export type ThemeMode = 'light' | 'dark';
export type ModePreference = 'system' | ThemeMode;
/** Saved reading colours are now available throughout the app. */
export type ReadingPreset = `local-${ReaderPalette}` | `paper-${PaperId}`;
export type ReadingTheme = 'app' | 'gray' | ReadingPreset;

export interface ThemePreference {
  theme: AppThemeId;
  mode: ModePreference;
  /** 跟随系统: the theme used while the device is light, and the one while it is dark. */
  system: { light: AppThemeId; dark: AppThemeId };
}
export interface ResolvedTheme { theme: ThemeId; mode: ThemeMode; preset?: ReadingPreset }

export const defaultThemePreference: ThemePreference = { theme: 'warm', mode: 'system', system: { light: 'warm', dark: 'warm' } };
const defaults = (): ThemePreference => ({ ...defaultThemePreference, system: { ...defaultThemePreference.system } });

const isAppTheme = (value: unknown): value is AppThemeId => typeof value === 'string' && (Object.hasOwn(themes, value) || isReadingPreset(value));
const preferenceKey = (scope: string) => 'reader.appearance.v1:' + scope;
const previousKey = (scope: string) => 'reader.theme.v2:' + scope;
/** V3 storage, read once to carry an existing choice over (spec §8). */
const legacyThemeKey = (scope: string) => 'reader.media.theme.v1:' + scope;
const legacyPairKey = (scope: string) => 'reader.media.theme.system.v1:' + scope;

export const themeChangeEvent = 'reader-theme-change';

export function validThemePreference(value: unknown): ThemePreference {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof ThemePreference, unknown>>;
  const system = (raw.system && typeof raw.system === 'object' ? raw.system : {}) as { light?: unknown; dark?: unknown };
  const theme = isAppTheme(raw.theme) ? raw.theme : defaultThemePreference.theme;
  const mode = raw.mode === 'light' || raw.mode === 'dark' || raw.mode === 'system' ? raw.mode : defaultThemePreference.mode;
  return {
    theme,
    mode: mode === 'system' ? mode : presetMode(theme) ?? mode,
    system: {
      light: isAppTheme(system.light) && presetMode(system.light) !== 'dark' ? system.light : defaultThemePreference.system.light,
      dark: isAppTheme(system.dark) && presetMode(system.dark) !== 'light' ? system.dark : defaultThemePreference.system.dark,
    },
  };
}

/**
 * The six V3 themes, mapped as the spec's table says: 暖纸/深夜 become 暖陶 light/dark,
 * 雾蓝 stays 雾蓝, 原野 becomes 青绿 light, 石墨 becomes 雾蓝 dark, and 蔷薇 (removed with
 * no successor) falls back to 暖陶 keeping its light mode.
 */
const legacyThemes: Record<string, { theme: AppThemeId; mode: ThemeMode }> = {
  sand: { theme: 'warm', mode: 'light' },
  midnight: { theme: 'warm', mode: 'dark' },
  ocean: { theme: 'blue', mode: 'light' },
  rose: { theme: 'warm', mode: 'light' },
  forest: { theme: 'green', mode: 'light' },
  graphite: { theme: 'blue', mode: 'dark' },
};

export function migrateLegacyTheme(choice: string | null, pair: unknown): ThemePreference {
  const oldPair = (pair && typeof pair === 'object' ? pair : {}) as { light?: unknown; dark?: unknown };
  const slot = (value: unknown) => (Object.hasOwn(legacyThemes, String(value)) ? legacyThemes[String(value)]?.theme : undefined) ?? 'warm';
  const system = { light: slot(oldPair.light), dark: slot(oldPair.dark) };
  const chosen = choice && Object.hasOwn(legacyThemes, choice) ? legacyThemes[choice] : undefined;
  if (chosen) return { ...defaults(), theme: chosen.theme, mode: chosen.mode, system };
  return { ...defaults(), theme: system.light, mode: 'system', system };
}

function readPreviousPreference(scope: string): ThemePreference {
  const stored = localStorage.getItem(previousKey(scope));
  if (stored !== null) {
    const raw = JSON.parse(stored);
    const preference = validThemePreference(raw);
    const reading = validReadingTheme(raw?.reading);
    return reading === 'app' ? preference : selectTheme(preference, reading);
  }
  const choice = localStorage.getItem(legacyThemeKey(scope));
  let pair: unknown;
  try { pair = JSON.parse(localStorage.getItem(legacyPairKey(scope)) ?? 'null'); } catch { /* use defaults */ }
  return migrateLegacyTheme(choice, pair);
}

export function readThemePreference(scope: string): ThemePreference {
  try {
    const stored = localStorage.getItem(preferenceKey(scope));
    return stored !== null ? validThemePreference(JSON.parse(stored)) : readPreviousPreference(scope);
  } catch { return defaults(); }
}

/** Import the old device choice once; later app choices must never be overridden by it. */
export function migrateAppearance(scope: string, settings: { readingTheme?: ReadingTheme; paper?: ReaderPaper; lastDayTheme?: ReaderPalette; lastNightTheme?: ReaderPalette }): void {
  try {
    if (localStorage.getItem(preferenceKey(scope)) !== null) return;
    let preference = readThemePreference(scope);
    const reading = settings.readingTheme ?? (settings.paper && settings.paper !== 'theme' ? readingThemeForPaper(settings.paper) : 'app');
    if (reading !== 'app') {
      const light = settings.lastDayTheme && PALETTES[settings.lastDayTheme]?.scheme === 'light' ? `local-${settings.lastDayTheme}` as AppThemeId : preference.system.light;
      const dark = settings.lastNightTheme && PALETTES[settings.lastNightTheme]?.scheme === 'dark' ? `local-${settings.lastNightTheme}` as AppThemeId : preference.system.dark;
      preference = selectTheme({ ...preference, system: { light, dark } }, reading);
    }
    saveThemePreference(scope, preference);
  } catch { /* A storage failure must not prevent opening a cached book. */ }
}

export function saveThemePreference(scope: string, patch: Partial<ThemePreference>): ThemePreference {
  const current = readThemePreference(scope);
  const next = validThemePreference({ ...current, ...patch, system: { ...current.system, ...patch.system } });
  try { localStorage.setItem(preferenceKey(scope), JSON.stringify(next)); } catch { throw new Error('设备无法保存主题，请检查浏览器存储空间或隐私设置。'); }
  // Storage events do not fire in the tab that made the change; tell this tab directly.
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(themeChangeEvent, { detail: { scope } }));
  return next;
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

/** What the app wears: the pair when following the system, otherwise the one theme and mode. */
export function resolveAppTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  const mode = preference.mode === 'system' ? (systemDark ? 'dark' : 'light') : preference.mode;
  const id = preference.mode === 'system' ? preference.system[mode] : preference.theme;
  return resolveTheme(id, mode);
}

export function resolveTheme(id: AppThemeId, mode: ThemeMode): ResolvedTheme {
  return isReadingPreset(id) ? { theme: 'gray', mode: readingPresetTokens(id).mode, preset: id } : { theme: id, mode };
}

export const resolveReadingTheme = resolveAppTheme;
const presetMode = (id: AppThemeId): ThemeMode | undefined => isReadingPreset(id) ? readingPresetTokens(id).mode : undefined;
export const selectedTheme = (preference: ThemePreference, systemDark: boolean): AppThemeId => preference.mode === 'system' ? preference.system[systemDark ? 'dark' : 'light'] : preference.theme;

/** A fixed-colour preset selects its own mode and remembers the opposite mode's choice. */
export function selectTheme(preference: ThemePreference, theme: AppThemeId): ThemePreference {
  const fixed = presetMode(theme);
  if (fixed) return { ...preference, theme, mode: fixed, system: { ...preference.system, [fixed]: theme } };
  return { ...preference, theme, system: preference.mode === 'system' ? { light: theme, dark: theme } : { ...preference.system, [preference.mode]: theme } };
}

export function selectThemeMode(preference: ThemePreference, mode: ModePreference): ThemePreference {
  if (mode === 'system') return { ...preference, mode };
  const theme = preference.system[mode];
  return { ...preference, theme, mode, system: { ...preference.system, [mode]: theme } };
}

export const themeTokens = ({ theme, mode, preset }: ResolvedTheme): ThemeTokens => preset ? readingPresetTokens(preset).tokens : themes[theme][mode];

/**
 * Reading papers: the page's own colours, a per-device reader setting (like the font
 * size). They tint only the reading surface — paper, ink, the readouts — while the
 * reader's chrome keeps the reading theme. `theme` means "no paper, use the theme".
 * The stylesheet mirrors these in theme-tokens.css (`.reader-screen[data-paper]`).
 */
export const readerPapers = {
  white: { id: 'white', name: '白纸', dark: false, bg: '#FFFFFF', ink: '#1A1A1A', muted: '#666666', line: '#E0E0E0' },
  warm: { id: 'warm', name: '暖黄', dark: false, bg: '#F4ECD8', ink: '#3B3226', muted: '#6B5D47', line: '#E2D5B8' },
  green: { id: 'green', name: '浅绿', dark: false, bg: '#DDE9D6', ink: '#26331F', muted: '#4C5E43', line: '#C5D6BB' },
  gray: { id: 'gray', name: '灰调', dark: false, bg: '#E6E6E3', ink: '#2A2A2A', muted: '#575754', line: '#D1D1CD' },
  night: { id: 'night', name: '夜间', dark: true, bg: '#1D1C1A', ink: '#D8D4CA', muted: '#9D988D', line: '#34322E' },
} as const;
export type PaperId = keyof typeof readerPapers;
export type ReaderPaper = 'theme' | PaperId | `local-${ReaderPalette}`;
export function localPaper(paper: ReaderPaper): ReaderPalette | null {
  const id = paper.startsWith('local-') ? paper.slice(6) : '';
  return Object.hasOwn(PALETTES, id) ? id as ReaderPalette : null;
}
export function paperColors(paper: Exclude<ReaderPaper, 'theme'>) {
  const id = localPaper(paper);
  if (!id) return readerPapers[paper as PaperId];
  const p = PALETTES[id];
  return { dark: p.scheme === 'dark', bg: p.background, ink: p.text, muted: p.muted, line: p.line };
}
export const paperIds = Object.keys(readerPapers) as PaperId[];
export const validReaderPaper = (value: unknown): ReaderPaper => value === 'theme' || paperIds.includes(value as PaperId) || (typeof value === 'string' && localPaper(value as ReaderPaper)) ? value as ReaderPaper : 'theme';

export function isReadingPreset(value: unknown): value is ReadingPreset {
  return typeof value === 'string' && (localPaper(value as ReaderPaper) !== null || (value.startsWith('paper-') && paperIds.includes(value.slice(6) as PaperId)));
}
export const validReadingTheme = (value: unknown): ReadingTheme => value === 'gray' || isReadingPreset(value) ? value : 'app';
export const readingThemeForPaper = (paper: Exclude<ReaderPaper, 'theme'>): ReadingPreset => localPaper(paper) ? paper as ReadingPreset : `paper-${paper as PaperId}`;

/** Existing colours become complete V3 reading themes, with a fixed light/dark mode. */
function readingPresetTokens(id: ReadingPreset): { mode: ThemeMode; tokens: ThemeTokens } {
  const legacy = localPaper(id as ReaderPaper);
  if (legacy) {
    const p = PALETTES[legacy];
    const mode = p.scheme;
    const tokens: ThemeTokens = { ...themes.gray[mode], bg: p.background, surface: p.surface, surface2: p.surface,
      ink: p.text, muted: p.muted, line: p.line, brand: p.accent, brandText: p.accent, brandSoft: p.surface,
      onBrand: p.onAccent, onCh: p.onAccent,
      ch: Object.fromEntries(channels.map(channel => [channel, { fill: p.accent, soft: p.surface, text: p.accent }])) as ThemeTokens['ch'] };
    return { mode, tokens };
  }
  const p = readerPapers[id.slice(6) as PaperId];
  const mode = p.dark ? 'dark' : 'light';
  return { mode, tokens: { ...themes.gray[mode], bg: p.bg, ink: p.ink, muted: p.muted, line: p.line } };
}

export const themeOptions: ReadonlyArray<{ value: AppThemeId; label: string }> = [
  ...Object.values(themes).map(theme => ({ value: theme.id, label: theme.name })),
  ...Object.entries(PALETTES).map(([id, p]) => ({ value: `local-${id}` as ReadingPreset, label: p.label })),
  ...paperIds.map(id => ({ value: `paper-${id}` as ReadingPreset, label: readerPapers[id].name + (id === 'green' || id === 'night' ? '纸色' : '') })),
];
export const themeName = (id: AppThemeId): string => themeOptions.find(option => option.value === id)?.label ?? themes.warm.name;

/** Both the shell and the reader consume these same semantic colours. */
export function applyThemeTokens(element: HTMLElement, resolved: ResolvedTheme | null): void {
  const tokens = themeTokens(resolved ?? { theme: 'warm', mode: 'light' });
  const colors: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    if (key !== 'ch') colors[key === 'surface2' ? 'surface-2' : key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())] = value as string;
  }
  for (const [channel, values] of Object.entries(tokens.ch)) {
    colors[`ch-${channel}`] = values.fill;
    colors[`ch-${channel}-soft`] = values.soft;
    colors[`ch-${channel}-text`] = values.text;
  }
  for (const [key, value] of Object.entries(colors)) {
    if (resolved) element.style.setProperty(`--color-${key}`, value);
    else element.style.removeProperty(`--color-${key}`);
  }
}

/** What the reading screen wears: a theme and mode for its chrome, and the paper (if any) for its page. */
export interface ReaderSurface extends ResolvedTheme { paper: Exclude<ReaderPaper, 'theme'> | null }

export function resolveReaderSurface(preference: ThemePreference, systemDark: boolean): ReaderSurface {
  return { ...resolveAppTheme(preference, systemDark), paper: null };
}

/** One subscription for every place that shows the theme: same-tab saves, other tabs, the OS. */
export function subscribeTheme(scope: string, notify: () => void): () => void {
  const query = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined;
  const keys = [preferenceKey(scope), previousKey(scope), legacyThemeKey(scope), legacyPairKey(scope)];
  const onStorage = (event: StorageEvent) => { if (event.key === null || keys.includes(event.key)) notify(); };
  const onChange = (event: Event) => { if ((event as CustomEvent<{ scope?: unknown }>).detail?.scope === scope) notify(); };
  query?.addEventListener('change', notify);
  window.addEventListener('storage', onStorage);
  window.addEventListener(themeChangeEvent, onChange);
  return () => {
    query?.removeEventListener('change', notify);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(themeChangeEvent, onChange);
  };
}

/** Writes the shared theme and semantic colours onto <html>. */
export class ThemeController {
  current: ResolvedTheme;
  private readonly scope: string;
  private readonly unsubscribe: () => void;
  constructor(scope: string, onChanged: () => void = () => undefined) {
    this.scope = scope;
    this.current = this.apply();
    this.unsubscribe = subscribeTheme(scope, () => { this.current = this.apply(); onChanged(); });
  }
  private apply() {
    const resolved = resolveAppTheme(readThemePreference(this.scope), systemPrefersDark());
    const root = document.documentElement;
    // Clear pre-bundle legacy paint before the app's semantic theme takes over.
    root.style.removeProperty('--reader-paper');
    root.style.removeProperty('--reader-browser-paper');
    root.style.removeProperty('color-scheme');
    root.dataset.theme = resolved.theme;
    root.dataset.mode = resolved.mode;
    applyThemeTokens(root, resolved);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeTokens(resolved).bg);
    return resolved;
  }
  dispose() {
    this.unsubscribe();
    applyThemeTokens(document.documentElement, null);
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.mode;
  }
}

/** The summary shown on 我的 and the settings home: "跟随系统", or "雾蓝 · 深色". */
export function themeSummary(preference: ThemePreference): string {
  if (preference.mode === 'system') return '跟随系统';
  return themeName(selectedTheme(preference, systemPrefersDark())) + ' · ' + (preference.mode === 'dark' ? '深色' : '浅色');
}
