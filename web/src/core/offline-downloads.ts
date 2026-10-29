import { ApiError } from '../api/errors.ts';
import type { ReaderApi } from '../api/client.ts';
import type { Manifest } from '../api/types.ts';
import type { Platform } from './platform.ts';
import { PublicationCache, publicationScope } from '../store/publications.ts';
import { OfflineDownload } from './offline-download.ts';

/** Device downloads outlive routes; their caches and requests belong to one account. */
// shortcut: The OS may suspend the page; native downloads are needed for lock-screen guarantees.
export class OfflineDownloads {
  private readonly tasks = new Map<string, { revision: string | undefined; task: OfflineDownload }>();
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  constructor(private readonly api: ReaderApi, private readonly platform: Pick<Platform, 'kv' | 'blobs'>) {}
  private scope(): string {
    const user = this.api.currentSession()?.user.id;
    return user ? publicationScope(this.api.baseUrl, user) : '';
  }
  private emit(): void { for (const listener of this.listeners) listener(); }
  onChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  running(bookId: string): boolean { return this.tasks.get(this.scope() + '\n' + bookId)?.task.state.status === 'running'; }
  async get(manifest: Manifest): Promise<OfflineDownload> {
    const scope = this.scope(), generation = this.generation, key = scope + '\n' + manifest.book.id;
    const current = () => !!scope && scope === this.scope() && generation === this.generation;
    if (!current()) throw new ApiError('aborted', '账号已切换，请重新打开下载面板');
    let entry = this.tasks.get(key);
    if (entry && entry.revision !== manifest.content?.revision) {
      await entry.task.pause();
      if (!current()) throw new ApiError('aborted', '账号已切换');
      if (this.tasks.get(key) !== entry) return this.get(manifest);
      entry = undefined;
    }
    if (!entry) {
      const cache = new PublicationCache(this.platform.kv, this.platform.blobs, scope);
      entry = { revision: manifest.content?.revision, task: new OfflineDownload(this.api, cache, manifest, () => this.emit(), current) };
      this.tasks.set(key, entry);
    }
    await entry.task.load();
    if (!current()) throw new ApiError('aborted', '账号已切换');
    return entry.task;
  }
  async clearBook(bookId: string): Promise<void> {
    const scope = this.scope(), entry = this.tasks.get(scope + '\n' + bookId);
    if (!scope) throw new ApiError('aborted', '账号已退出');
    if (entry) await entry.task.clear();
    else await new PublicationCache(this.platform.kv, this.platform.blobs, scope).removeBook(bookId);
  }
  async clear(): Promise<void> {
    const tasks = [...this.tasks.values()];
    this.generation++; this.tasks.clear();
    await Promise.allSettled(tasks.filter(entry => entry.task.state.status === 'running').map(entry => entry.task.pause()));
    this.emit();
  }
}
