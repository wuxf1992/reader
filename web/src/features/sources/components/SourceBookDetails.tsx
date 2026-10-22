import { Alert, Badge, Button, getDefaultZIndex, Modal, SegmentedControl } from '@mantine/core';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sourceChapterCount } from '../../../ui/source-results.ts';
import type { SourceEntry } from '../../../api/sources.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';

export function SourceBookDetails({ entry, sourceId, sourceName, inShelf, canPreview, onChapterCount, onDirectoryOpenChange }: {
  entry: SourceEntry; sourceId: string; sourceName: string | undefined; inShelf: boolean | undefined; canPreview: boolean; onChapterCount: (ref: string, count: number) => void; onDirectoryOpenChange: (open: boolean) => void;
}) {
  const { api } = useRuntime();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cover, setCover] = useState<string | null>(null);
  const [coverReady, setCoverReady] = useState(!entry.coverUrl || entry.shelfBookId === undefined);
  const [expanded, setExpanded] = useState(false);
  const [descending, setDescending] = useState(true);
  const directoryOpen = location.state?.sourceDirectory === sourceId + ':' + entry.ref;
  useEffect(() => {
    onDirectoryOpenChange(directoryOpen);
    if (!directoryOpen) void queryClient.cancelQueries({ queryKey: ['source-chapters', api.baseUrl, sourceId, entry.ref], exact: true });
    return () => onDirectoryOpenChange(false);
  }, [directoryOpen, onDirectoryOpenChange, queryClient, api.baseUrl, sourceId, entry.ref]);
  const directory = useQuery({ queryKey: ['source-chapters', api.baseUrl, sourceId, entry.ref], queryFn: ({ signal }) => api.sourceChapters(sourceId, entry.ref, { signal }), enabled: canPreview && directoryOpen && coverReady, staleTime: 60_000, retry: false, refetchOnWindowFocus: false });
  useEffect(() => { if (directory.data) onChapterCount(entry.ref, directory.data.length); }, [directory.data, entry.ref, onChapterCount]);
  const count = directory.data?.length ?? sourceChapterCount(entry);
  const chapters = descending ? directory.data?.slice().reverse() : directory.data;

  useEffect(() => {
    setCover(null); setCoverReady(!entry.coverUrl || entry.shelfBookId === undefined);
    if (!entry.coverUrl || entry.shelfBookId === undefined) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const path = entry.coverUrl.startsWith('/api/v1/books/') ? entry.coverUrl
      : `/api/v1/sources/${encodeURIComponent(sourceId)}/cover?ref=${encodeURIComponent(entry.ref)}`;
    void api.coverBytes(path, { signal: controller.signal }).then(bytes => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(new Blob([bytes as BlobPart]));
      setCover(objectUrl);
    }).catch(() => {}).finally(() => { if (!controller.signal.aborted) setCoverReady(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, sourceId, entry.ref, entry.coverUrl, entry.shelfBookId]);
  const description = entry.description?.trim() || '暂无简介';
  const long = description.length > 160;
  return <article className="book-detail source-book-detail">
    <div className="source-book-detail-heading">
      <div className="source-book-detail-cover">
        {cover ? <img src={cover} alt={`${entry.title}封面`} onError={() => setCover(null)} /> : <span>暂无封面</span>}
      </div>
      <div className="source-book-detail-title">
        <h3>{entry.title}</h3>
        <p className="book-detail-author">{entry.authors?.join('、') || '作者未知'}</p>
        {inShelf !== undefined && <Badge color={inShelf ? 'green' : 'gray'} variant="light">{inShelf ? '已加入书架' : '尚未加入书架'}</Badge>}
      </div>
    </div>
    <dl><dt>书源</dt><dd>{entry.sourceName || sourceName || '暂无信息'}</dd><dt>最新章节</dt><dd>{entry.latestChapter || '暂无信息'}</dd></dl>
    {canPreview && <button type="button" className="source-directory-trigger" aria-label="查看目录" aria-haspopup="dialog" onClick={() => navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { state: { ...location.state, sourceDirectory: sourceId + ':' + entry.ref }, preventScrollReset: true })}><strong>章节目录</strong><span>{count === undefined ? '章数待获取' : `共 ${count} 章`}<ChevronRight size={18} aria-hidden="true" /></span></button>}
    <Modal opened={directoryOpen} onClose={() => navigate(-1)} title="章节目录" className="source-directory-modal" centered xOffset="1.5rem" yOffset="10dvh" size="lg" radius="md" zIndex={getDefaultZIndex('modal') + 2} closeButtonProps={{ 'aria-label': '关闭目录' }}>
      <section className="source-book-directory" aria-label={entry.title + '章节目录'}>
        <div className="source-directory-heading"><div><h3>{entry.title}</h3><p>{count === undefined ? '章数待获取' : `共 ${count} 章`}</p></div><SegmentedControl aria-label="章节排序" size="sm" value={descending ? 'desc' : 'asc'} onChange={value => setDescending(value === 'desc')} data={[{ value: 'desc', label: '倒序' }, { value: 'asc', label: '正序' }]} /></div>
        {(directory.isPending || directory.isFetching) && <p role="status">正在加载目录…</p>}
        {directory.isError && <Alert color="red">{directory.error.message || '目录加载失败'}<Button variant="subtle" onClick={() => void directory.refetch()}>重试加载目录</Button></Alert>}
        {directory.data && <>
          {!directory.data.length && <p>暂无章节</p>}
          <ol key={descending ? 'desc' : 'asc'} tabIndex={0} aria-label="滚动查看章节">{chapters?.map(chapter => <li key={chapter.id}>{chapter.title}</li>)}</ol>
        </>}
      </section>
    </Modal>
    <h4>内容简介</h4>
    <p id="source-book-description" className="book-detail-description">{long && !expanded ? description.slice(0, 160) + '…' : description}</p>
    {long && <Button variant="subtle" size="compact-sm" aria-expanded={expanded} aria-controls="source-book-description" onClick={() => setExpanded(value => !value)}>{expanded ? '收起简介' : '展开完整简介'}</Button>}
  </article>;
}
