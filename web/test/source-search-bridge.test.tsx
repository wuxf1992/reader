// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import { dismissAllNotices } from '../src/ui/notifications.ts';
import type { ExtensionPage, SourceInstance, SourcePage } from '../src/api/sources.ts';
import {
  classifySources,
  entryOriginLinks,
  extractExtensionSearchView,
  safeHttpUrl,
  sourceExploreLink,
  sourceSearchLink,
  sourcesForBookShelf,
  sourcesForMediaScope,
} from '../src/features/sources/source-search-bridge.ts';
import { SearchPage } from '../src/features/search/pages/SearchPage.tsx';
import { MediaSearchPage } from '../src/features/media/pages/MediaSearchPage.tsx';
import { MediaCatalogPage } from '../src/features/media/pages/MediaCatalogPage.tsx';
import { ShelfPage } from '../src/features/shelf/pages/ShelfPage.tsx';
import { SourceExtensionPage } from '../src/features/sources/pages/SourceExtensionPage.tsx';
import { SourceOriginLinks } from '../src/features/sources/components/SourceOriginLinks.tsx';

const root = document.createElement('div');
document.body.append(root);

const adminUser = {
  id: 'u-admin',
  username: 'admin',
  displayName: '管理员',
  role: 'admin' as const,
  createdAt: 0,
  mediaEnabled: true,
  features: { media: true },
};

const memberUser = {
  id: 'u-member',
  username: 'member',
  displayName: '普通成员',
  role: 'member' as const,
  createdAt: 0,
  mediaEnabled: true,
  features: { media: true },
};

const sampleSources: SourceInstance[] = [
  {
    id: 'local-lib',
    pluginId: 'reader.local',
    sourceType: 'local',
    name: '本地书库',
    enabled: true,
    descriptor: {
      id: 'local',
      pluginId: 'reader.local',
      label: '本地书库',
      version: '1.0.0',
      builtin: true,
      capabilities: ['browse', 'search'],
    },
  },
  {
    id: 'novel-1',
    pluginId: 'reader.source.novelweb',
    sourceType: 'novel-web',
    name: '网络小说',
    enabled: true,
    isDefault: true,
    descriptor: {
      id: 'novel-web',
      pluginId: 'reader.source.novelweb',
      label: '网络小说',
      version: '1.8.1',
      builtin: false,
      capabilities: ['browse', 'search', 'search.filters', 'detail', 'acquire.chapters'],
      extensions: { pages: [{ id: 'legacy-sources', title: '网站与书源管理' }] },
    },
  },
  {
    id: 'comic-1',
    pluginId: 'reader.source.novelweb',
    sourceType: 'comic-web',
    name: '在线漫画',
    enabled: true,
    descriptor: {
      id: 'comic-web',
      pluginId: 'reader.source.novelweb',
      label: '在线漫画',
      version: '1.8.1',
      builtin: false,
      capabilities: ['browse', 'search', 'search.filters', 'detail', 'acquire.chapters'],
      extensions: { pages: [{ id: 'media-sources', title: '漫画规则管理' }] },
    },
  },
  {
    id: 'video-1',
    pluginId: 'reader.source.novelweb',
    sourceType: 'video-web',
    name: '在线视频',
    enabled: true,
    descriptor: {
      id: 'video-web',
      pluginId: 'reader.source.novelweb',
      label: '在线视频',
      version: '1.8.1',
      builtin: false,
      capabilities: [],
      extensions: { pages: [{ id: 'media-sources', title: '在线视频' }] },
    },
  },
  {
    id: 'audio-1',
    pluginId: 'reader.source.novelweb',
    sourceType: 'audio-web',
    name: '在线有声书',
    enabled: true,
    descriptor: {
      id: 'audio-web',
      pluginId: 'reader.source.novelweb',
      label: '在线有声书',
      version: '1.8.1',
      builtin: false,
      capabilities: [],
      extensions: { pages: [{ id: 'media-sources', title: '在线有声书' }] },
    },
  },
  {
    id: 'music-1',
    pluginId: 'reader.source.novelweb',
    sourceType: 'music-web',
    name: '在线音乐',
    enabled: true,
    descriptor: {
      id: 'music-web',
      pluginId: 'reader.source.novelweb',
      label: '在线音乐',
      version: '1.8.3',
      builtin: false,
      capabilities: [],
      extensions: { pages: [{ id: 'media-sources', title: '在线音乐' }] },
    },
  },
  {
    id: 'video-disabled',
    pluginId: 'reader.source.novelweb',
    sourceType: 'video-web',
    name: '停用视频源',
    enabled: false,
    descriptor: {
      id: 'video-web',
      pluginId: 'reader.source.novelweb',
      label: '在线视频',
      version: '1.8.1',
      builtin: false,
      capabilities: [],
      extensions: { pages: [{ id: 'media-sources', title: '在线视频' }] },
    },
  },
];

function makeVideoPage(overrides: Partial<ExtensionPage> = {}): ExtensionPage {
  return {
    title: '在线视频',
    forms: [],
    activeTab: 'search',
    tabs: [
      {
        id: 'search',
        title: '搜片与播放',
        forms: [
          {
            id: 'search',
            title: '',
            submit: '搜索',
            fields: [
              { key: 'query', label: '片名', type: 'text', required: true, value: '三体' },
              {
                key: 'site',
                label: '书源',
                type: 'select',
                value: '',
                options: [
                  { value: '', label: '主力源' },
                  { value: 'backup', label: '备用源' },
                ],
              },
            ],
          },
        ],
        sections: [
          {
            title: '搜索结果',
            emptyText: '没有找到影片',
            items: [
              {
                title: '三体（剧版）',
                description: '测试影视站',
                forms: [
                  {
                    id: 'episodes',
                    title: '',
                    submit: '查看剧集',
                    layout: 'inline',
                    fields: [],
                    values: { ref: 'vid-1' },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeEpisodesPage(withPlayback = false): ExtensionPage {
  return {
    title: '在线视频',
    forms: [],
    activeTab: 'search',
    ...(withPlayback
      ? {
          playback: {
            title: '三体（剧版） · 第01集',
            kind: 'file' as const,
            path: '/api/v1/sources/playback/aaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbb',
          },
        }
      : {}),
    tabs: [
      {
        id: 'search',
        title: '搜片与播放',
        forms: [],
        sections: [
          {
            title: '三体（剧版）',
            emptyText: '无剧集',
            items: [
              {
                title: '第01集',
                forms: [
                  {
                    id: 'play',
                    title: '',
                    submit: '播放',
                    layout: 'inline',
                    fields: [],
                    values: { ref: 'vid-1', episode: 'ep-1', page: 1 },
                  },
                ],
              },
              {
                title: '第02集',
                forms: [
                  {
                    id: 'play',
                    title: '',
                    submit: '播放',
                    layout: 'inline',
                    fields: [],
                    values: { ref: 'vid-1', episode: 'ep-2', page: 1 },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

let client: QueryClient;

function setUser(user: typeof adminUser | typeof memberUser) {
  useAuthStore.setState({
    session: {
      user,
      accessToken: 'token',
      refreshToken: 'refresh',
      accessTokenExpiresAt: 9e15,
      refreshTokenExpiresAt: 9e15,
    },
    verifiedUser: user,
  });
}

function createRuntime(overrides: Record<string, unknown> = {}) {
  const api = {
    baseUrl: 'https://reader.example',
    currentSession: () => useAuthStore.getState().session,
    sources: vi.fn(async () => sampleSources),
    sourceFilters: vi.fn(async () => [
      {
        key: 'site',
        label: '书源',
        type: 'select',
        value: 'all',
        options: [
          { value: 'all', label: '主力源' },
          { value: 'backup', label: '备用源' },
        ],
      },
    ]),
    searchSource: vi.fn(async function* (): AsyncGenerator<SourcePage> {
      yield {
        items: [
          {
            ref: 'novel-ref-1',
            title: '三体',
            authors: ['刘慈欣'],
            latestChapter: '第38章',
            sourceName: '测试书站',
            metadata: { originUrl: 'https://site.example/', bookUrl: 'https://site.example/book/1' },
          },
        ],
        batch: { completed: 2, total: 2 },
      };
    }),
    acquireSource: vi.fn(async () => ({ kind: 'ready' as const, publicationId: 'book-acquired-1' })),
    sourcePage: vi.fn(async (_id: string, _pageId: string, action?: string, values?: Record<string, unknown>) => {
      if (action === 'search') {
        if (values?.site === '') {
          return makeVideoPage({
            tabs: [
              {
                id: 'search',
                title: '搜片与播放',
                forms: [],
                sections: [{ title: '搜索结果', emptyText: '没有找到影片', items: [] }],
              },
            ],
          });
        }
        return makeVideoPage();
      }
      if (action === 'episodes') return makeEpisodesPage(false);
      if (action === 'play') return makeEpisodesPage(true);
      return makeVideoPage({ tabs: [{ id: 'search', title: '搜片与播放', forms: [{ id: 'search', title: '', submit: '搜索', fields: [] }], sections: [] }] });
    }),
    listBooks: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 24 })),
    shelfGroups: vi.fn(async () => ({ series: [], tags: [] })),
    coverBytes: vi.fn().mockRejectedValue(new Error('none')),
    ...(overrides.api as Record<string, unknown> | undefined),
  };
  const mediaApi = {
    preferenceScope: () => 'bridge-test',
    search: vi.fn(async () => ({ items: [], total: 0 })),
    browse: vi.fn(async () => ({ items: [], total: 0 })),
    items: vi.fn(async () => ({ items: [], total: 0 })),
    request: vi.fn(async () => ({ items: [], total: 0 })),
    libraries: vi.fn(async () => ({ items: [] })),
    cover: vi.fn().mockRejectedValue(new Error('none')),
    ...(overrides.mediaApi as Record<string, unknown> | undefined),
  };
  return {
    api,
    mediaApi,
    offline: {
      current: {},
      books: () => [],
      progressFor: () => undefined,
      replaceBooks: async () => undefined,
      removeBooks: async () => undefined,
    },
    player: { play: vi.fn() },
    updateSettings: vi.fn(async () => undefined),
  } as any;
}

function mount(element: React.ReactNode, runtime: any, initialPath = '/') {
  act(() =>
    render(
      <RuntimeContext.Provider value={runtime}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[initialPath]}>{element}</MemoryRouter>
        </QueryClientProvider>
      </RuntimeContext.Provider>,
      root,
    ),
  );
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setUser(adminUser);
});

afterEach(() => {
  act(() => render(null, root));
  client.clear();
  vi.clearAllMocks();
  localStorage.clear();
  useAuthStore.setState({ session: null, verifiedUser: null });
  dismissAllNotices();
});

describe('source-search-bridge helpers', () => {
  it('classifies enabled plugin sources while respecting admin and mediaEnabled boundaries', () => {
    const adminAll = classifySources(sampleSources, { admin: true, mediaEnabled: true });
    expect(adminAll.map((item) => [item.source.id, item.channel, item.mode])).toEqual([
      ['novel-1', 'novel', 'catalog'],
      ['comic-1', 'comic', 'catalog'],
      ['video-1', 'video', 'extension'],
      ['audio-1', 'audiobook', 'extension'],
      ['music-1', 'music', 'extension'],
    ]);

    const memberAll = classifySources(sampleSources, { admin: false, mediaEnabled: true });
    expect(memberAll.map((item) => item.source.id)).toEqual(['novel-1', 'comic-1']);

    const pureReading = classifySources(sampleSources, { admin: true, mediaEnabled: false });
    expect(pureReading.map((item) => item.source.id)).toEqual(['novel-1', 'comic-1']);

    expect(sourcesForMediaScope(adminAll, 'video').map((item) => item.source.id)).toEqual(['video-1']);
    expect(sourcesForMediaScope(adminAll, 'audiobook').map((item) => item.source.id)).toEqual(['audio-1']);
    expect(sourcesForMediaScope(adminAll, 'music').map((item) => item.source.id)).toEqual(['music-1']);
    expect(sourcesForMediaScope(adminAll, 'all').map((item) => item.source.id)).toEqual([
      'video-1',
      'audio-1',
      'music-1',
    ]);
    expect(adminAll.map((item) => [item.source.id, item.browsable])).toEqual([
      ['novel-1', true],
      ['comic-1', true],
      ['video-1', true],
      ['audio-1', true],
      ['music-1', true],
    ]);
    expect(sourcesForBookShelf(adminAll).map((item) => item.source.id)).toEqual(['novel-1', 'comic-1']);

    expect(sourceSearchLink(adminAll[0]!, '三体')).toBe('/sources?source=novel-1&q=%E4%B8%89%E4%BD%93');
    expect(sourceSearchLink(adminAll[2]!, '三体', 'backup')).toBe(
      '/sources/video-1/media-sources?q=%E4%B8%89%E4%BD%93&site=backup',
    );
  });

  it('extracts extension search results, backup suggestion, and episode pagination', () => {
    const emptyMain = extractExtensionSearchView(
      makeVideoPage({
        tabs: [
          {
            id: 'search',
            title: '搜片与播放',
            forms: [],
            sections: [{ title: '搜索结果', emptyText: '没有找到影片', items: [] }],
          },
        ],
      }),
      '',
    );
    expect(emptyMain.suggestBackupPool).toBe(true);
    expect(emptyMain.isEpisodesView).toBe(false);

    const episodes = extractExtensionSearchView(makeEpisodesPage(true), 'backup');
    expect(episodes.isEpisodesView).toBe(true);
    expect(episodes.items.map((item) => item.title)).toEqual(['第01集', '第02集']);
    expect(episodes.playback?.title).toBe('三体（剧版） · 第01集');
  });
});

describe('cross-homepage source search UI', () => {
  it('shows click-to-search online sources on /search without auto-scraping on render, and acquires books in place', async () => {
    const runtime = createRuntime();
    mount(<SearchPage />, runtime, '/search?q=三体');

    await vi.waitFor(() => expect(root.querySelector('[aria-label="在线书源搜索"]')).not.toBeNull());
    // Must not fire external scraper requests until the user explicitly picks a source.
    expect(runtime.api.searchSource).not.toHaveBeenCalled();
    expect(runtime.api.sourcePage).not.toHaveBeenCalled();

    const novelTab = [...root.querySelectorAll<HTMLButtonElement>('.source-bridge-tab')].find((button) =>
      button.textContent?.includes('网络小说'),
    )!;
    await act(async () => novelTab.click());

    await vi.waitFor(() => expect(runtime.api.searchSource).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(root.textContent).toContain('刘慈欣'));

    const pageLink = root.querySelector<HTMLAnchorElement>('.source-origin-links a[href="https://site.example/book/1"]');
    expect(pageLink?.textContent).toBe('原页 ↗');
    expect(pageLink?.target).toBe('_blank');
    expect(pageLink?.rel).toContain('noopener');
    expect(root.querySelector('.source-origin-links a[href="https://site.example/"]')?.textContent).toBe('原站 ↗');
    const addButton = [...root.querySelectorAll<HTMLButtonElement>('.source-bridge-action')].find(
      (button) => button.textContent === '加入书架',
    )!;
    await act(async () => addButton.click());

    await vi.waitFor(() => expect(runtime.api.acquireSource).toHaveBeenCalledWith('novel-1', 'novel-ref-1'));
    await vi.waitFor(() => expect(root.querySelector('a[href="/book/book-acquired-1"]')?.textContent).toBe('开始阅读'));
  });

  it('auto-searches online video sources on /media/search?scope=video, switches to backup pool, lists episodes, and plays in place', async () => {
    const runtime = createRuntime();
    mount(
      <Routes>
        <Route path="/media/search" element={<MediaSearchPage />} />
      </Routes>,
      runtime,
      '/media/search?q=三体&scope=video',
    );

    await vi.waitFor(() =>
      expect(runtime.api.sourcePage).toHaveBeenCalledWith('video-1', 'media-sources', 'search', {
        query: '三体',
        site: '',
      }),
    );
    await vi.waitFor(() => expect(root.textContent).toContain('改用备用源搜索'));

    const backupButton = [...root.querySelectorAll<HTMLButtonElement>('.source-bridge-action')].find(
      (button) => button.textContent === '改用备用源搜索',
    )!;
    await act(async () => backupButton.click());

    await vi.waitFor(() =>
      expect(runtime.api.sourcePage).toHaveBeenCalledWith('video-1', 'media-sources', 'search', {
        query: '三体',
        site: 'backup',
      }),
    );
    await vi.waitFor(() => expect(root.textContent).toContain('三体（剧版）'));

    const episodesButton = [...root.querySelectorAll<HTMLButtonElement>('.source-bridge-action')].find(
      (button) => button.textContent === '查看剧集',
    )!;
    await act(async () => episodesButton.click());

    await vi.waitFor(() => expect(root.querySelectorAll('.source-bridge-episode').length).toBe(2));

    const playButton = root.querySelector<HTMLButtonElement>('.source-bridge-episode')!;
    await act(async () => playButton.click());

    await vi.waitFor(() => expect(root.querySelector('video.source-video')).not.toBeNull());
    expect(playButton.getAttribute('aria-current')).toBe('true');

    // Back to search results preserves previous results without another search network request.
    const callCountBeforeBack = runtime.api.sourcePage.mock.calls.length;
    const backButton = [...root.querySelectorAll<HTMLButtonElement>('.source-bridge-action')].find(
      (button) => button.textContent === '返回搜索结果',
    )!;
    await act(async () => backButton.click());
    expect(root.textContent).toContain('三体（剧版）');
    expect(runtime.api.sourcePage.mock.calls.length).toBe(callCountBeforeBack);
  });

  it('passes channel scope from MediaCatalogPage search button and shows online shortcut when empty', async () => {
    const runtime = createRuntime();
    mount(
      <Routes>
        <Route path="/media/:channel/:category?" element={<MediaCatalogPage />} />
      </Routes>,
      runtime,
      '/media/video',
    );

    await vi.waitFor(() => expect(root.querySelector('[aria-label="在线视频源入口"]')).not.toBeNull());
    const topSearch = root.querySelector<HTMLAnchorElement>('a[aria-label="搜索"]');
    expect(topSearch?.getAttribute('href')).toBe('/media/search?scope=video');
  });

  it('shows quick novel and comic source links on /shelf when filtering by keyword', async () => {
    const runtime = createRuntime();
    mount(
      <Routes>
        <Route path="/shelf" element={<ShelfPage />} />
      </Routes>,
      runtime,
      '/shelf?q=海贼王',
    );

    await vi.waitFor(() => expect(root.querySelector('[aria-label="在在线书源中搜索"]')).not.toBeNull());
    const links = [...root.querySelectorAll<HTMLAnchorElement>('[aria-label="在在线书源中搜索"] a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/sources?source=novel-1&q=%E6%B5%B7%E8%B4%BC%E7%8E%8B',
      '/sources?source=comic-1&q=%E6%B5%B7%E8%B4%BC%E7%8E%8B',
    ]);
  });

  it('auto-runs search on SourceExtensionPage when opened with ?q= deep link', async () => {
    const runtime = createRuntime();
    mount(
      <Routes>
        <Route path="/sources/:sourceId/:pageId" element={<SourceExtensionPage />} />
      </Routes>,
      runtime,
      '/sources/video-1/media-sources?q=流浪地球&site=backup',
    );

    await vi.waitFor(() =>
      expect(runtime.api.sourcePage).toHaveBeenCalledWith('video-1', 'media-sources', 'search', {
        query: '流浪地球',
        site: 'backup',
      }),
    );
  });
});

describe('music, browsing and original-site entries', () => {
  it('builds explore links per mode and only accepts plain http(s) addresses from plugins', () => {
    const [novel, , video] = classifySources(sampleSources, { admin: true, mediaEnabled: true });
    expect(sourceExploreLink(novel!)).toBe('/sources?tab=explore&source=novel-1');
    expect(sourceExploreLink(video!)).toBe('/sources/video-1/media-sources?tab=discover');
    expect(safeHttpUrl('https://a.example/x?y=1')).toBe('https://a.example/x?y=1');
    for (const unsafe of ['javascript:alert(1)', 'data:text/html,x', 'https://u:p@a.example/', '/relative', 7, undefined])
      expect(safeHttpUrl(unsafe)).toBeUndefined();
    expect(
      entryOriginLinks({ metadata: { originUrl: 'https://a.example/', bookUrl: 'javascript:1' } }),
    ).toEqual({ site: 'https://a.example/' });
  });

  it('renders no link for an entry without safe addresses and opens the rest in a new tab', async () => {
    act(() => render(<SourceOriginLinks entry={{ metadata: { bookUrl: 'javascript:alert(1)' } }} />, root));
    expect(root.querySelector('a')).toBeNull();
    act(() =>
      render(
        <SourceOriginLinks entry={{ metadata: { originUrl: 'https://a.example/', bookUrl: 'https://a.example/b' } }} />,
        root,
      ),
    );
    expect([...root.querySelectorAll('a')].map((link) => [link.textContent, link.target])).toEqual([
      ['原页 ↗', '_blank'],
      ['原站 ↗', '_blank'],
    ]);
  });

  it('searches online music from /media/search?scope=music and shows the source websites', async () => {
    const runtime = createRuntime({
      api: {
        sourcePage: vi.fn(async (_id: string, _pageId: string, action?: string) => ({
          ...makeVideoPage(),
          title: '在线音乐',
          links: [
            { title: '好音乐 ↗', url: 'https://music.example/' },
            { title: '坏链接 ↗', url: 'javascript:alert(1)' },
          ],
          ...(action === 'search' ? {} : { tabs: undefined }),
        })),
      },
    });
    mount(
      <Routes>
        <Route path="/media/search" element={<MediaSearchPage />} />
      </Routes>,
      runtime,
      '/media/search?q=晴天&scope=music',
    );
    await vi.waitFor(() =>
      expect(runtime.api.sourcePage).toHaveBeenCalledWith('music-1', 'media-sources', 'search', {
        query: '晴天',
        site: '',
      }),
    );
    expect(runtime.api.sourcePage).not.toHaveBeenCalledWith('video-1', expect.anything(), 'search', expect.anything());
    await vi.waitFor(() => expect(root.querySelector('.source-bridge-site')).not.toBeNull());
    expect([...root.querySelectorAll<HTMLAnchorElement>('.source-bridge-site')].map((link) => link.href)).toEqual([
      'https://music.example/',
    ]);
    expect(root.querySelector('a[href="/sources/music-1/media-sources?tab=discover"]')?.textContent).toContain('发现浏览');
    expect(root.textContent).toContain('在线音乐源');
  });

  it('offers browsing next to search on a populated channel page', async () => {
    const runtime = createRuntime({
      mediaApi: {
        browse: vi.fn(async () => ({
          total: 1,
          items: [
            { id: 'v1', libraryId: 'lib', kind: 'video', title: '本地影片', parentId: null, metadata: {}, overrides: {} },
          ],
        })),
      },
    });
    mount(
      <Routes>
        <Route path="/media/:channel/:category?" element={<MediaCatalogPage />} />
      </Routes>,
      runtime,
      '/media/video',
    );
    await vi.waitFor(() => expect(root.querySelector('[aria-label="在线视频源"]')).not.toBeNull());
    expect(root.querySelector('[aria-label="在线视频源入口"]')).toBeNull();
    const bar = root.querySelector('[aria-label="在线视频源"]')!;
    expect([...bar.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
      '/media/search?scope=video',
      '/sources/video-1/media-sources?tab=discover',
      '/sources/video-1/media-sources',
    ]);
  });

  it('adds a category entry to the shelf row only when a book source can be browsed', async () => {
    const runtime = createRuntime();
    mount(
      <Routes>
        <Route path="/shelf" element={<ShelfPage />} />
      </Routes>,
      runtime,
      '/shelf',
    );
    await vi.waitFor(() => expect(root.querySelector('a[href="/sources?tab=explore&source=novel-1"]')).not.toBeNull());
    expect(root.querySelector('a[href="/sources?tab=explore&source=novel-1"]')?.textContent).toContain('在线发现');
  });

  it('opens the 发现浏览 tab of a plugin page from a ?tab=discover link', async () => {
    const runtime = createRuntime({
      api: {
        sourcePage: vi.fn(async () => ({
          title: '在线视频',
          forms: [],
          activeTab: 'search',
          tabs: [
            { id: 'search', title: '搜片与播放', forms: [], sections: [] },
            { id: 'discover', title: '发现浏览', forms: [], sections: [] },
          ],
        })),
      },
    });
    mount(
      <Routes>
        <Route path="/sources/:sourceId/:pageId" element={<SourceExtensionPage />} />
      </Routes>,
      runtime,
      '/sources/video-1/media-sources?tab=discover',
    );
    await vi.waitFor(() =>
      expect(root.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('发现浏览'),
    );
  });

  it('offers a one-click add link on music/audiobook homepages when the plugin type exists but no instance is added yet', async () => {
    const runtime = createRuntime({
      api: {
        sources: vi.fn(async () => sampleSources.filter((s) => s.sourceType !== 'music-web')),
        sourceTypes: vi.fn(async () => [
          {
            id: 'music-web',
            pluginId: 'reader.source.novelweb',
            label: '在线音乐',
            version: '1.8.3',
            builtin: false,
            capabilities: [],
          },
        ]),
      },
    });
    mount(
      <Routes>
        <Route path="/media/:channel/:category?" element={<MediaCatalogPage />} />
      </Routes>,
      runtime,
      '/media/music/albums',
    );
    await vi.waitFor(() => expect(root.querySelector('[aria-label="添加在线音乐源入口"]')).not.toBeNull());
    const link = root.querySelector<HTMLAnchorElement>('[aria-label="添加在线音乐源入口"] a');
    expect(link?.getAttribute('href')).toBe(
      '/sources/manage/new?type=reader.source.novelweb%2Fmusic-web&name=%E5%9C%A8%E7%BA%BF%E9%9F%B3%E4%B9%90',
    );
  });
});
