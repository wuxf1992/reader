import { useEffect, useRef, useState } from 'react';
import type { ExtensionPage } from '../../../api/sources.ts';

export function SourceVideo({
  playback,
  baseUrl,
}: {
  playback: NonNullable<ExtensionPage['playback']>;
  baseUrl: string;
}) {
  const media = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const validPath = /^\/api\/v1\/sources\/playback\/[\w-]{24}\/[\w-]{24}$/.test(playback.path);
  const url = validPath ? baseUrl + playback.path : '';
  useEffect(() => {
    const video = media.current;
    if (!video || !url) return;
    video.scrollIntoView?.({ block: 'nearest' });
    let close = () => {};
    let disposed = false;
    const failed = () => setError('视频加载失败。请换一集，或重新选择这一集。');
    if (playback.kind === 'file' || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
    } else {
      void import('hls.js')
        .then(({ default: Hls }) => {
          if (disposed) return;
          if (!Hls.isSupported()) {
            setError('当前浏览器不支持 HLS 播放。');
            return;
          }
          const player = new Hls();
          close = () => player.destroy();
          player.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) failed();
          });
          player.loadSource(url);
          player.attachMedia(video);
        })
        .catch(() => {
          if (!disposed) failed();
        });
    }
    video.addEventListener('error', failed);
    return () => {
      disposed = true;
      close();
      video.removeEventListener('error', failed);
      video.removeAttribute('src');
      video.load();
    };
  }, [playback.kind, url]);
  if (!url) return null;
  return (
    <section className="sources-card">
      <h2>{playback.title}</h2>
      <video ref={media} className="source-video" aria-label={playback.title} autoPlay controls playsInline />
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
