/**
 * A cover fetched through the API only once it scrolls into view.
 *
 * Source covers are read through the server and the book source behind it, one
 * request each, so a list of fifty results must not ask for fifty images at once.
 * Bytes and object URL lifetimes use the same account-scoped cache as book covers.
 */
import { type JSX, useEffect, useRef, useState } from 'react';
import { useRuntime } from '../app/providers/runtime-context.tsx';
import { useCover } from './use-cover.ts';

export function LazyCover({
  url,
  title,
  className,
}: {
  url: string | null;
  title: string;
  className?: string;
}): JSX.Element {
  const { api } = useRuntime();
  const frame = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const src = useCover(api, url, visible);
  useEffect(() => {
    const node = frame.current;
    if (!node || visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);
  return (
    <span ref={frame} className={className ? `lazy-cover ${className}` : 'lazy-cover'} aria-hidden="true">
      {src ? (
        <img src={src} alt="" />
      ) : (
        <span className="lazy-cover-placeholder">{title.trim().slice(0, 1) || '书'}</span>
      )}
    </span>
  );
}
