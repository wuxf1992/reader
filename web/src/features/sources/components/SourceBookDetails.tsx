import { Button, Callout, Segmented } from '../../../ui/toolkit.tsx';
import { Sheet } from '../../../ui/sheet.tsx';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCover } from '../../../ui/use-cover.ts';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sourceChapterCount } from '../../../ui/source-results.ts';
import type { SourceEntry } from '../../../api/sources.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';

export function SourceBookDetails({ entry, sourceId, sourceName, inShelf, canPreview, onChapterCount }: {
  entry: SourceEntry; sourceId: string; sourceName: string | undefined; inShelf: boolean | undefined; canPreview: boolean; onChapterCount: (ref: string, count: number) => void;
}) {
  const { api } = useRuntime();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [descending, setDescending] = useState(true);
  const directoryOpen = location.state?.sourceDirectory === sourceId + ':' + entry.ref;
  const bookCover = entry.coverUrl?.startsWith('/api/v1/books/');
  const coverPath = entry.coverUrl && entry.shelfBookId !== undefined ? bookCover ? entry.coverUrl
    : `/api/v1/sources/${encodeURIComponent(sourceId)}/cover?ref=${encodeURIComponent(entry.ref)}` : null;
  const userId = api.currentSession()?.user.id;
  const cover = useCover(api, coverPath, bookCover || !directoryOpen);
  useEffect(() => {
    if (!directoryOpen) void queryClient.cancelQueries({ queryKey: ['source-chapters', api.baseUrl, sourceId, entry.ref], exact: true });
    if (directoryOpen && !bookCover && coverPath) void queryClient.cancelQueries({ queryKey: ['book-cover', api.baseUrl, userId, coverPath], exact: true });
  }, [directoryOpen, queryClient, api.baseUrl, sourceId, entry.ref, userId, bookCover, coverPath]);
  const directory = useQuery({ queryKey: ['source-chapters', api.baseUrl, sourceId, entry.ref], queryFn: ({ signal }) => api.sourceChapters(sourceId, entry.ref, { signal }), enabled: canPreview && directoryOpen, staleTime: 60_000, retry: false, refetchOnWindowFocus: false });
  useEffect(() => { if (directory.data) onChapterCount(entry.ref, directory.data.length); }, [directory.data, entry.ref, onChapterCount]);
  const count = directory.data?.length ?? sourceChapterCount(entry);
  const chapters = descending ? directory.data?.slice().reverse() : directory.data;

  const description = entry.description?.trim() || '暂无简介';
  const long = description.length > 160;
  return <article className="book-detail source-book-detail">
    <div className="source-book-detail-heading">
      <div className="source-book-detail-cover">
        {cover && cover !== failedCover ? <img src={cover} alt={`${entry.title}封面`} onError={() => setFailedCover(cover)} /> : <span>暂无封面</span>}
      </div>
      <div className="source-book-detail-title">
        <h3>{entry.title}</h3>
        <p className="book-detail-author">{entry.authors?.join('、') || '作者未知'}</p>
        {inShelf !== undefined && <span className="source-shelf-state">{inShelf ? '已加入书架' : '尚未加入书架'}</span>}
      </div>
    </div>
    <dl><dt>书源</dt><dd>{entry.sourceName || sourceName || '暂无信息'}</dd><dt>最新章节</dt><dd>{entry.latestChapter || '暂无信息'}</dd></dl>
    {canPreview && <button type="button" className="source-directory-trigger" aria-label="查看目录" aria-haspopup="dialog" onClick={() => { navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { state: { ...location.state, sourceDirectory: sourceId + ':' + entry.ref }, preventScrollReset: true }); }}><strong>章节目录</strong><span>{count === undefined ? '章数待获取' : `共 ${count} 章`}<ChevronRight size={18} aria-hidden="true" /></span></button>}
    {directoryOpen && <Sheet onClose={() => navigate(-1)} title="章节目录" className="source-directory-modal" size="wide">
      <section className="source-book-directory" aria-label={entry.title + '章节目录'}>
        <div className="source-directory-heading"><div><h3>{entry.title}</h3><p>{count === undefined ? '章数待获取' : `共 ${count} 章`}</p></div><Segmented label="章节排序" value={descending ? 'desc' : 'asc'} onChange={value => setDescending(value === 'desc')} options={[{ value: 'desc', label: '倒序' }, { value: 'asc', label: '正序' }]} /></div>
        {(directory.isPending || directory.isFetching) && <p role="status">正在加载目录…</p>}
        {directory.isError && <Callout tone="error">{directory.error.message || '目录加载失败'}<Button onClick={() => void directory.refetch()}>重试加载目录</Button></Callout>}
        {directory.data && <>
          {!directory.data.length && <p>暂无章节</p>}
          <ol key={descending ? 'desc' : 'asc'} tabIndex={0} aria-label="滚动查看章节">{chapters?.map(chapter => <li key={chapter.id}>{chapter.title}</li>)}</ol>
        </>}
      </section>
    </Sheet>}
    <h4>内容简介</h4>
    <p id="source-book-description" className="book-detail-description">{long && !expanded ? description.slice(0, 160) + '…' : description}</p>
    {long && <Button aria-expanded={expanded} aria-controls="source-book-description" onClick={() => setExpanded(value => !value)}>{expanded ? '收起简介' : '展开完整简介'}</Button>}
  </article>;
}
