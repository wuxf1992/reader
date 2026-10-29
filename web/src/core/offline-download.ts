import { ApiError } from '../api/errors.ts';
import type { ReaderApi } from '../api/client.ts';
import type { Manifest } from '../api/types.ts';
import { OFFLINE_FILE, PublicationCache } from '../store/publications.ts';
import { renditionRef } from '../ui/rendition.ts';

export interface DownloadState {
  status: 'idle' | 'running' | 'paused' | 'cancelled' | 'complete' | 'error';
  completed: number; total: number; from: number; to: number; message: string; revision?: string | undefined;
}
export class OfflineDownload {
  state: DownloadState = { status: 'idle', completed: 0, total: 0, from: 1, to: 1, message: '' };
  private run: AbortController | null = null;
  private loading: Promise<void> | null = null;
  private readonly listeners = new Set<(state: DownloadState) => void>();
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly api: ReaderApi, private readonly cache: PublicationCache,
    private readonly manifest: Manifest, private readonly changed: (state: DownloadState) => void,
    private readonly current: () => boolean = () => true) {}

  onChange(listener: (state: DownloadState) => void): () => void {
    this.listeners.add(listener); listener({ ...this.state });
    return () => this.listeners.delete(listener);
  }
  private emit(): void {
    this.changed({ ...this.state });
    for (const listener of this.listeners) listener({ ...this.state });
  }
  load(): Promise<void> {
    if (this.run) return Promise.resolve();
    return this.loading ??= this.restore().catch(error => { this.loading = null; throw error; });
  }
  private async restore(): Promise<void> {
    const raw = await this.cache.task(this.manifest.book.id);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as DownloadState;
      if (saved.revision !== this.manifest.content?.revision) return;
      this.state = saved;
      if (this.state.status === 'running') { this.state.status = 'paused'; this.state.message = '已暂停，可继续下载'; }
      this.emit();
    } catch { /* A missing task never invalidates cached chapters. */ }
  }
  async pause(cancel = false): Promise<void> {
    this.run?.abort();
    await this.pending;
    await this.update({ status: cancel ? 'cancelled' : 'paused', message: cancel ? '已取消，已下载内容保留' : '已暂停，可继续下载' });
  }
  async clear(): Promise<void> {
    await this.pause(true);
    await this.cache.removeBook(this.manifest.book.id);
    await this.update({ status: 'idle', completed: 0, total: 0, from: 1, to: 1, message: '' });
  }
  private assertCurrent(signal: AbortSignal): void {
    signal.throwIfAborted();
    if (!this.current()) throw new ApiError('aborted', '账号或服务已切换，下载已暂停');
  }
  async start(from = 1, to = ['chapters', 'txt'].includes(this.manifest.book.format) ? this.manifest.content?.total ?? 1 : 1): Promise<void> {
    if (this.run) return;
    const run = this.run = new AbortController();
    this.pending = this.download(run, from, to).finally(() => { if (this.run === run) this.run = null; });
    await this.pending;
  }
  private async update(patch: Partial<DownloadState>): Promise<void> {
    this.state = { ...this.state, ...patch }; this.emit();
    await this.cache.putTask(this.manifest.book.id, JSON.stringify(this.state));
  }
  private async download(run: AbortController, from: number, to: number): Promise<void> {
    const book = this.manifest.book, signal = run.signal;
    try {
      this.assertCurrent(signal);
      const overrides = await this.cache.overrides(book.id);
      this.assertCurrent(signal);
      const chapters = ['chapters', 'txt'].includes(book.format) && !!this.manifest.content && !(book.format === 'txt' && overrides?.headingPrefix);
      const total = chapters ? this.manifest.content?.total ?? 0 : 1;
      if (book.format === 'image' && this.manifest.files.length > 1) throw new Error('图片目录暂不支持整书离线下载');
      if (!['chapters', 'epub', 'txt', 'pdf', 'cbz', 'zip', 'image'].includes(book.format)) throw new Error('此格式暂不支持整书离线下载');
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > total) throw new Error('章节范围无效');
      await this.update({ status: 'running', from, to, total: to - from + 1, completed: 0, message: '正在下载', revision: this.manifest.content?.revision });
      this.assertCurrent(signal);
      await this.cache.putManifest(book.id, this.manifest);
      this.assertCurrent(signal);
      if (!chapters) {
        // Complete EPUB archives carry CSS/fonts/images, unlike isolated chapter HTML.
        const cached = await this.cache.resource(book.id, OFFLINE_FILE);
        this.assertCurrent(signal);
        const bytes = cached ?? await this.api.bookBytes(book.id, { signal });
        this.assertCurrent(signal); await this.cache.putResource(book.id, OFFLINE_FILE, bytes);
        await this.update({ completed: 1 });
      } else {
        const content = this.manifest.content!;
        const items = [];
        for (let group = 0; group < Math.max(1, content.groups.length); group++) {
          this.assertCurrent(signal);
          const shape = content.groups[group];
          if (shape && (shape.offset >= to || shape.offset + shape.count < from)) continue;
          const window = group === (content.group ?? 0) ? content : await this.api.items(book.id, group, { signal });
          this.assertCurrent(signal);
          await this.cache.putWindow(book.id, group, window);
          items.push(...window.items.filter(item => item.seq >= from - 1 && item.seq < to));
        }
        if (items.length !== to - from + 1) throw new Error('目录已变化，请重新打开书籍再下载');
        for (const item of items) {
          this.assertCurrent(signal); const ref = renditionRef(item);
          const cached = await this.cache.resource(book.id, ref);
          this.assertCurrent(signal);
          if (!cached) {
            const blob = await this.api.asset(book.id, ref, { signal });
            const bytes = new Uint8Array(await blob.arrayBuffer());
            this.assertCurrent(signal); await this.cache.putResource(book.id, ref, bytes);
          }
          this.assertCurrent(signal); await this.update({ completed: this.state.completed + 1 });
        }
      }
      this.assertCurrent(signal); await this.update({ status: 'complete', message: chapters ? '所选章节已可离线阅读' : '整书已可离线阅读' });
    } catch (error) {
      if (!signal.aborted) await this.update({ status: this.current() ? 'error' : 'paused', message: error instanceof Error ? error.message : '下载失败，可重试' });
    }
  }
}
