import type { ExtensionForm, ExtensionPage, SourceInstance } from '../../api/sources.ts';
import type { MediaChannel } from '../media/api/media-api.ts';

export type BridgeChannel = 'novel' | 'comic' | 'video' | 'audiobook' | 'music';

export interface BridgeSource {
  source: SourceInstance;
  channel: BridgeChannel;
  mode: 'catalog' | 'extension';
  pageId?: string;
  label: string;
  /** Offers category browsing: the host `browse` capability, or the plugin page's 发现 tab. */
  browsable: boolean;
}

const CHANNEL_ORDER: Record<BridgeChannel, number> = {
  novel: 0,
  comic: 1,
  video: 2,
  audiobook: 3,
  music: 4,
};

export const BRIDGE_CHANNEL_LABELS: Record<BridgeChannel, string> = {
  novel: '小说',
  comic: '漫画',
  video: '视频',
  audiobook: '有声书',
  music: '音乐',
};

function inferChannel(sourceType: string): BridgeChannel {
  if (/video/i.test(sourceType)) return 'video';
  if (/music|song/i.test(sourceType)) return 'music';
  if (/audio/i.test(sourceType)) return 'audiobook';
  if (/comic|manga/i.test(sourceType)) return 'comic';
  return 'novel';
}

export function classifySource(
  source: SourceInstance,
  options: { admin: boolean; mediaEnabled: boolean },
): BridgeSource | null {
  if (!source.enabled || !source.descriptor) return null;
  if (source.descriptor.builtin && source.sourceType === 'local') return null;

  const channel = inferChannel(source.sourceType);
  const isMedia = channel === 'video' || channel === 'audiobook' || channel === 'music';
  if (isMedia && !options.mediaEnabled) return null;

  if (source.descriptor.capabilities.includes('search')) {
    return {
      source,
      channel,
      mode: 'catalog',
      label: source.name || source.descriptor.label || BRIDGE_CHANNEL_LABELS[channel],
      browsable: source.descriptor.capabilities.includes('browse'),
    };
  }

  const pageId = source.descriptor.extensions?.pages?.[0]?.id;
  if (isMedia && options.admin && pageId) {
    return {
      source,
      channel,
      mode: 'extension',
      pageId,
      label: source.name || source.descriptor.label || BRIDGE_CHANNEL_LABELS[channel],
      browsable: true,
    };
  }

  return null;
}

export function classifySources(
  sources: readonly SourceInstance[] | undefined,
  options: { admin: boolean; mediaEnabled: boolean },
): BridgeSource[] {
  if (!sources?.length) return [];
  const classified: BridgeSource[] = [];
  for (const source of sources) {
    const item = classifySource(source, options);
    if (item) classified.push(item);
  }
  classified.sort(
    (a, b) =>
      CHANNEL_ORDER[a.channel] - CHANNEL_ORDER[b.channel] ||
      Number(Boolean(b.source.isDefault)) - Number(Boolean(a.source.isDefault)) ||
      a.label.localeCompare(b.label, 'zh-CN'),
  );
  return classified;
}

export function sourcesForMediaScope(
  sources: readonly BridgeSource[],
  scope: MediaChannel | 'all',
): BridgeSource[] {
  if (scope === 'video') return sources.filter((item) => item.channel === 'video');
  if (scope === 'audiobook') return sources.filter((item) => item.channel === 'audiobook');
  if (scope === 'music') return sources.filter((item) => item.channel === 'music');
  if (scope === 'all') return sources.filter((item) => item.channel !== 'novel' && item.channel !== 'comic');
  return [];
}

export function sourcesForBookShelf(sources: readonly BridgeSource[]): BridgeSource[] {
  return sources.filter((item) => item.channel === 'novel' || item.channel === 'comic');
}

export function sourceManageLink(item: BridgeSource): string {
  const pageId = item.pageId ?? item.source.descriptor?.extensions?.pages?.[0]?.id;
  if (pageId) {
    return `/sources/${encodeURIComponent(item.source.id)}/${encodeURIComponent(pageId)}`;
  }
  return '/sources?tab=sources';
}

/** Where a source's categories are browsed without a keyword. */
export function sourceExploreLink(item: BridgeSource): string {
  if (item.mode === 'extension' && item.pageId)
    return `/sources/${encodeURIComponent(item.source.id)}/${encodeURIComponent(item.pageId)}?tab=discover`;
  return `/sources?tab=explore&source=${encodeURIComponent(item.source.id)}`;
}

/** An http(s) address a plugin supplied, or undefined: never a script, a credential or a relative path. */
export function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** The website and the work's own page behind a result, when the plugin reported them. */
export function entryOriginLinks(entry: { metadata?: Record<string, unknown> | undefined }): {
  site?: string;
  page?: string;
} {
  const site = safeHttpUrl(entry.metadata?.originUrl);
  const page = safeHttpUrl(entry.metadata?.bookUrl);
  return { ...(site ? { site } : {}), ...(page ? { page } : {}) };
}

export function sourceSearchLink(item: BridgeSource, query?: string, site?: string): string {
  const trimmed = query?.trim() ?? '';
  if (item.mode === 'extension' && item.pageId) {
    const params = new URLSearchParams();
    if (trimmed) params.set('q', trimmed);
    if (site) params.set('site', site);
    const suffix = params.toString();
    return `/sources/${encodeURIComponent(item.source.id)}/${encodeURIComponent(item.pageId)}${suffix ? `?${suffix}` : ''}`;
  }
  const params = new URLSearchParams({ source: item.source.id });
  if (trimmed) params.set('q', trimmed);
  return `/sources?${params.toString()}`;
}

export interface ExtensionSearchItem {
  title: string;
  description?: string;
  primaryForm?: ExtensionForm;
  forms: ExtensionForm[];
}

export interface ExtensionSearchView {
  notice?: string;
  noticeKind?: 'info' | 'error';
  playback?: ExtensionPage['playback'];
  poolOptions: Array<{ value: string; label: string }>;
  sectionTitle?: string;
  emptyText?: string;
  items: ExtensionSearchItem[];
  paginationForms: ExtensionForm[];
  paginationLabel?: string;
  isEpisodesView: boolean;
  suggestBackupPool: boolean;
}

const DEFAULT_POOL_OPTIONS = [
  { value: '', label: '主力源' },
  { value: 'backup', label: '备用源' },
];

export function extractExtensionSearchView(page: ExtensionPage, pool: string): ExtensionSearchView {
  const searchTab = page.tabs?.find((tab) => tab.id === 'search');
  const content = searchTab ?? page;
  const searchForm = content.forms?.find((form) => form.id === 'search');
  const siteField = searchForm?.fields?.find((field) => field.key === 'site' && field.type === 'select');
  const poolOptions = siteField?.options?.length
    ? siteField.options.map((option) => ({ value: option.value, label: option.label }))
    : DEFAULT_POOL_OPTIONS;

  const primarySection = content.sections?.[0];
  const rawItems = primarySection?.items ?? [];

  const items: ExtensionSearchItem[] = [];
  let paginationForms: ExtensionForm[] = [];
  let paginationLabel: string | undefined;
  let isEpisodesView = false;

  for (const raw of rawItems) {
    const forms = raw.forms ?? [];
    const playForm = forms.find((form) => form.id === 'play');
    const episodesForm = forms.find((form) => form.id === 'episodes');
    const isPaginationRow =
      !playForm &&
      forms.length > 0 &&
      forms.every((form) => form.id === 'episodes' && (form.submit === '上一页' || form.submit === '下一页'));

    if (isPaginationRow) {
      paginationForms = forms;
      paginationLabel = raw.title;
      continue;
    }

    if (playForm) isEpisodesView = true;
    const primaryForm = playForm ?? episodesForm;
    items.push({
      title: raw.title,
      ...(raw.description ? { description: raw.description } : {}),
      ...(primaryForm ? { primaryForm } : {}),
      forms,
    });
  }

  const hasBackupOption = poolOptions.some((option) => option.value === 'backup');
  const suggestBackupPool =
    hasBackupOption &&
    pool === '' &&
    !isEpisodesView &&
    items.length === 0 &&
    (primarySection?.title?.includes('主力源') || Boolean(primarySection));

  return {
    ...(page.notice ? { notice: page.notice } : {}),
    ...(page.noticeKind ? { noticeKind: page.noticeKind } : {}),
    ...(page.playback ? { playback: page.playback } : {}),
    poolOptions,
    ...(primarySection?.title ? { sectionTitle: primarySection.title } : {}),
    ...(primarySection?.emptyText ? { emptyText: primarySection.emptyText } : {}),
    items,
    paginationForms,
    ...(paginationLabel ? { paginationLabel } : {}),
    isEpisodesView,
    suggestBackupPool,
  };
}
