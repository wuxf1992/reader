import { useLayoutEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReaderApi } from '../api/client.ts';

/** Share bytes across book views; object URLs belong to each mounted image. */
export function useCover(api: ReaderApi, coverUrl: string | null | undefined, enabled = true): string | null {
  const client = useQueryClient();
  const queryKey = ['book-cover', api.baseUrl, api.currentSession()?.user.id, coverUrl];
  const query = useQuery({
    queryKey,
    enabled: !!coverUrl && enabled,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: 'always',
    structuralSharing: (previous, next) => previous instanceof Uint8Array && next instanceof Uint8Array
      && previous.length === next.length && previous.every((byte, index) => byte === next[index]) ? previous : next,
    queryFn: ({ signal }) => api.coverBytes(coverUrl!, { signal }, bytes => client.setQueryData(queryKey, bytes)),
  });
  // Offline failures are handled by coverBytes; explicit permission failures must hide the image.
  const bytes = query.isError ? undefined : query.data;
  const [image, setImage] = useState<{ bytes: Uint8Array; src: string } | null>(null);
  useLayoutEffect(() => {
    if (!bytes?.byteLength) { setImage(null); return; }
    const src = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
    setImage({ bytes, src });
    return () => URL.revokeObjectURL(src);
  }, [bytes]);
  return image?.bytes === bytes ? image?.src ?? null : null;
}
