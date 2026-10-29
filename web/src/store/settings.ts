import { PALETTES, clampBrightness, type ThemeMode } from '../render/theme.ts';
import type { KeyValueStore } from '../core/platform.ts';
import type { ViewSettings } from '../ui/reader-view.ts';
import { CHINESE_VARIANTS } from '../shared/chinese-variant.ts';
import { readingThemeForPaper, validReadingTheme, validReaderPaper, type ReadingTheme, type ReaderPaper } from '../shared/theme/theme.ts';

/**
 * Reader preferences, persisted per device.
 *
 * Per *device*, not per account: text size and theme are properties of the
 * screen and the lighting you are reading in, not of who you are. Syncing them
 * would push a phone's text size onto a tablet, which is worse than not syncing.
 */

const KEY = 'reader.settings.v1';
const SERVER_KEY = 'reader.server.v1';

/** How densely the shelf lays its covers out. */
export type ShelfDensity = 'compact' | 'cozy' | 'comfortable';
/**
 * What the shelf can be ordered by.
 *
 * Four keys, and they answer three different questions a reader actually asks:
 * *where was I* (`recent`, the default), *what did I just put in there* (`added`),
 * and *what is this book called / who wrote it* (`title`, `author`).
 *
 * `recent` is the one the shelf opens on, and it is deliberately not the same
 * question as `added`: a library that opens on "what did I add last" answers a
 * question the reader asks once a week, while "where was I" is asked every time
 * the app is opened. `updated` is kept as an alias of `added` so a stored
 * preference from an older build keeps working (see `shelf-settings.tsx`).
 */
export type ShelfSort = 'recent' | 'added' | 'title' | 'author';

export type ReadoutMode = 'none' | 'book' | 'chapter' | 'progress' | 'time';
export const READOUT_FIELDS = [
  { key: 'readoutTopLeft', label: '顶部左侧' },
  { key: 'readoutTopRight', label: '顶部右侧' },
  { key: 'readoutBottomLeft', label: '底部左侧' },
  { key: 'readoutBottomRight', label: '底部右侧' },
] as const;
export const READOUT_OPTIONS: Array<{ value: ReadoutMode; label: string }> = [
  { value: 'none', label: '不显示' },
  { value: 'book', label: '书名' },
  { value: 'chapter', label: '章节名' },
  { value: 'progress', label: '章节进度' },
  { value: 'time', label: '时间' },
];

export interface AppSettings extends ViewSettings {
  liquidGlass: boolean;
  /** One complete reading theme; absent until an existing scoped choice is read. */
  readingTheme?: ReadingTheme;
  pageInsets: Record<'top' | 'bottom' | 'left' | 'right', number>;
  lastDayTheme: ViewSettings['theme'];
  lastNightTheme: ViewSettings['theme'];
  readerSections: Record<'readout' | 'text' | 'theme' | 'paging', boolean>;
  readoutTopLeft: ReadoutMode;
  readoutTopRight: ReadoutMode;
  readoutBottomLeft: ReadoutMode;
  readoutBottomRight: ReadoutMode;
  /** UTF-8 by default; a reader can force another for an odd TXT file. */
  txtEncoding: string;
  autoCache: boolean;
  autoCacheChapters: number;
  /** Only meaningful for fixed-layout books. */
  comicDirection: 'ltr' | 'rtl';
  /**
   * The page's own colours (阅读纸色): 白纸, 暖黄, 浅绿, 灰调, 夜间, or `theme` for the
   * reading theme's. Per device, like the font size; the chrome keeps its theme.
   */
  paper: ReaderPaper;
  /** A light paper gives way to the theme's dark values while the app is dark. */
  paperFollowsDark: boolean;
  /** Read-aloud preferences. The voice itself is per device, like the rest. */
  ttsRate: number;
  ttsPitch: number;
  ttsVolume: number;
  ttsVoice: string;
  /** Keep reading into the next chapter when the current one runs out. */
  ttsAutoAdvance: boolean;
  /**
   * Which engine speaks.
   *
   * `auto` rather than a concrete engine, because the right answer depends on the
   * host and the reader has no way to know: the native engine does not exist in a
   * browser, the HTTP engine does not exist on a server with no `TTS_URL`, and a
   * phone that had one engine yesterday may have another today. `auto` resolves
   * per session against what is actually there (see `speechAvailability`), and
   * pinning a specific engine is offered for the reader who wants it — usually to
   * escape a bad voice on the system engine.
   */
  ttsEngine: 'auto' | 'system' | 'http' | 'native';

  // ---- shelf ----
  /**
   * Covers per row, i.e. how much of the title is readable.
   *
   * A per-device setting for the same reason the font size is: a phone with a
   * 6-inch screen and a desktop monitor want different numbers of covers, and a
   * synced value would be wrong on one of them.
   */
  shelfDensity: ShelfDensity;
  /** What the shelf sorts by when the reader has not picked this session. */
  shelfSort: ShelfSort;
  /** Show the author under each cover. Off makes the grid much quieter. */
  shelfShowAuthor: boolean;
  /** Show the progress bar under a cover that has been started. */
  shelfShowProgress: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  liquidGlass: false,
  pageInsets: { top: 0, bottom: 0, left: 0, right: 0 },
  readoutTopLeft: 'chapter',
  readoutTopRight: 'none',
  readoutBottomLeft: 'progress',
  readoutBottomRight: 'time',
  mode: 'scroll',
  fontScale: 1,
  lineHeight: 'inherit',
  theme: 'light',
  lastDayTheme: 'light',
  lastNightTheme: 'dark',
  readerSections: { readout: true, text: true, theme: true, paging: true },
  fit: 'contain',
  direction: 'ltr',
  fontFamily: 'inherit',
  pageMargin: 1.5,
  textAlign: 'inherit',
  chineseVariant: 'original',
  brightness: 1,
  pageAnimation: 'slide',
  tapZone: 'standard',
  txtIndent: 2,
  txtParagraphGap: 0.55,
  txtEncoding: '',
  autoCache: true,
  autoCacheChapters: 3,
  comicDirection: 'ltr',
  paper: 'theme',
  paperFollowsDark: true,
  ttsRate: 1,
  ttsPitch: 1,
  ttsVolume: 1,
  ttsVoice: '',
  ttsAutoAdvance: true,
  ttsEngine: 'auto',
  shelfDensity: 'cozy',
  shelfSort: 'recent',
  shelfShowAuthor: true,
  shelfShowProgress: true,
};

export class SettingsStore {
  private settings: AppSettings = { ...DEFAULT_APP_SETTINGS };
  private loaded = false;

  constructor(private readonly kv: KeyValueStore) {}

  async load(): Promise<AppSettings> {
    if (this.loaded) return this.settings;
    const raw = await this.kv.get(KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<AppSettings> & { shelfSort?: string };
        this.settings = { ...DEFAULT_APP_SETTINGS, ...parsed };
        this.settings.pageInsets = normalizePageInsets(parsed.pageInsets);
        this.settings.brightness = clampBrightness(this.settings.brightness);
        this.settings.liquidGlass = parsed.liquidGlass === true;
        if (!CHINESE_VARIANTS.some(option => option.value === this.settings.chineseVariant)) this.settings.chineseVariant = 'original';
        if (typeof this.settings.theme !== 'string' || !Object.prototype.hasOwnProperty.call(PALETTES, this.settings.theme)) {
          this.settings.theme = DEFAULT_APP_SETTINGS.theme;
        }
        for (const key of ['lastDayTheme', 'lastNightTheme'] as const) {
          const scheme = key === 'lastDayTheme' ? 'light' : 'dark';
          const theme = this.settings[key];
          if (typeof theme !== 'string' || !Object.prototype.hasOwnProperty.call(PALETTES, theme) || PALETTES[theme].scheme !== scheme) {
            this.settings[key] = DEFAULT_APP_SETTINGS[key];
          }
          if (!parsed[key] && PALETTES[this.settings.theme].scheme === scheme) this.settings[key] = this.settings.theme;
        }
        this.settings.readerSections = { ...DEFAULT_APP_SETTINGS.readerSections };
        for (const key of Object.keys(this.settings.readerSections) as Array<keyof AppSettings['readerSections']>) {
          if (typeof parsed.readerSections?.[key] === 'boolean') this.settings.readerSections[key] = parsed.readerSections[key];
        }
        if (typeof this.settings.autoCache !== 'boolean') this.settings.autoCache = DEFAULT_APP_SETTINGS.autoCache;
        if (!Number.isInteger(this.settings.autoCacheChapters) || this.settings.autoCacheChapters < 1 || this.settings.autoCacheChapters > 50) {
          this.settings.autoCacheChapters = DEFAULT_APP_SETTINGS.autoCacheChapters;
        }
        for (const { key } of READOUT_FIELDS) {
          if (!READOUT_OPTIONS.some(option => option.value === this.settings[key])) {
            this.settings[key] = DEFAULT_APP_SETTINGS[key];
          }
        }
        /*
         * Two stored values are folded forward, and both are the same repair.
         *
         * `updated` used to be the shelf's only date sort and it meant "the file
         * changed" — which for a library imported once is very nearly "when I added
         * it". It is now *named* `added`, which is what it always was in practice,
         * and `updated` no longer exists as a choice; left folded, a reader who had
         * picked it would open the shelf on a key the sort sheet cannot show and the
         * server would receive an unknown `sort`.
         *
         * `title` and `author` are untouched: they still mean what they meant.
         */
        if (this.settings.shelfSort === ('updated' as string)) this.settings.shelfSort = 'added';
        /*
         * The reading paper is the reader's old page theme coming back as its own
         * setting: a device that had chosen sepia, green or dark before V3 gets the
         * matching paper the first time, instead of silently losing it.
         */
        if (parsed.paper === undefined) {
          this.settings.paper = typeof parsed.theme === 'string' && Object.hasOwn(PALETTES, parsed.theme) ? `local-${this.settings.theme}` : 'theme';
          if (this.settings.paper !== 'theme') this.settings.paperFollowsDark = false;
        }
        this.settings.paper = validReaderPaper(this.settings.paper);
        if (typeof this.settings.paperFollowsDark !== 'boolean') this.settings.paperFollowsDark = true;
        if (parsed.readingTheme !== undefined) this.settings.readingTheme = validReadingTheme(parsed.readingTheme);
        else if (this.settings.paper !== 'theme') this.settings.readingTheme = readingThemeForPaper(this.settings.paper);
        if (this.settings.readingTheme !== undefined) this.settings.paper = 'theme';
        if (!['recent', 'added', 'title', 'author'].includes(this.settings.shelfSort)) {
          this.settings.shelfSort = DEFAULT_APP_SETTINGS.shelfSort;
        }
      } catch {
        this.settings = { ...DEFAULT_APP_SETTINGS };
      }
    }
    this.loaded = true;
    return this.settings;
  }

  get current(): AppSettings {
    return this.settings;
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = { ...this.settings, ...withThemeMemory(this.settings, patch) };
    this.settings.pageInsets = normalizePageInsets(this.settings.pageInsets);
    await this.kv.set(KEY, JSON.stringify(this.settings));
    return this.settings;
  }

  async serverUrl(): Promise<string> {
    // An Android build ships with a baked-in default and an empty stored value
    // must not shadow it, so the fallback lives in the caller.
    return (await this.kv.get(SERVER_KEY)) ?? '';
  }

  async setServerUrl(url: string): Promise<void> {
    await this.kv.set(SERVER_KEY, url.replace(/\/+$/, ''));
  }
}

function normalizePageInsets(value: AppSettings['pageInsets'] | undefined): AppSettings['pageInsets'] {
  const insets = { ...DEFAULT_APP_SETTINGS.pageInsets };
  for (const edge of Object.keys(insets) as Array<keyof typeof insets>) {
    const number = value?.[edge];
    if (typeof number === 'number' && Number.isFinite(number)) insets[edge] = Math.max(0, Math.min(80, Math.round(number)));
  }
  return insets;
}

export function withThemeMemory(settings: AppSettings, patch: Partial<AppSettings>): Partial<AppSettings> {
  if (!patch.theme) return patch;
  const memoryKey = (theme: ThemeMode) => PALETTES[theme].scheme === 'dark' ? 'lastNightTheme' : 'lastDayTheme';
  return { [memoryKey(settings.theme)]: settings.theme, readingTheme: `local-${patch.theme}`, paper: 'theme', paperFollowsDark: false, ...patch, [memoryKey(patch.theme)]: patch.theme };
}
