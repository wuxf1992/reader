import { useRef } from 'react';
import { useLocation, useNavigationType, useSearchParams, useNavigate } from 'react-router-dom';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { MediaSearch } from '../components/search.tsx';
import { MediaPageFrame } from '../components/MediaPageFrame.tsx';
import type { MediaChannel } from '../api/media-api.ts';
import { MediaSourceSearchSection } from '../../sources/components/HomeSourceSearch.tsx';

export function MediaSearchPage() {
  const runtime = useRuntime(),
    navigate = useNavigate(),
    location = useLocation(),
    [params, setParams] = useSearchParams();
  // The URL (query, scope, page) is the search; a result's back arrow returns to it, and so does the scroll.
  const here = location.pathname + location.search;
  // The search reads the URL when it mounts. Its own changes push new entries and keep it
  // mounted; browser Back/Forward (POP) between two searches remounts it on that entry's URL.
  const navigationType = useNavigationType(),
    seen = useRef({ key: location.key, mount: 0 });
  if (seen.current.key !== location.key)
    seen.current = { key: location.key, mount: seen.current.mount + (navigationType === 'POP' ? 1 : 0) };
  const rawScope = params.get('scope') ?? 'all';
  const scope = (['all', 'video', 'music', 'audiobook'].includes(rawScope) ? rawScope : 'all') as MediaChannel | 'all';
  const query = params.get('q') ?? '';
  return (
    <MediaPageFrame className="media-secondary-page" title="搜索" backLabel="返回搜索来源">
      <MediaSearch
        key={seen.current.mount}
        api={runtime.mediaApi}
        channel="video"
        navigate={(channel, id) =>
          navigate(`/media/${channel}/items/${encodeURIComponent(id)}`, { state: { returnTo: here } })
        }
        initialLocation={{
          q: query,
          scope,
          offset: params.get('offset') ?? '0',
        }}
        onLocationChange={(next) => setParams(next)}
        scrollKey={runtime.mediaApi.preferenceScope() + '\0' + here}
      />
      <MediaSourceSearchSection scope={scope} query={query} />
    </MediaPageFrame>
  );
}
