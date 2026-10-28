// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import type { ReaderApi } from '../src/api/client.ts';
import { ApiError } from '../src/api/errors.ts';
import { render } from '../src/shared/ui/render-root.ts';
import { useCover } from '../src/ui/use-cover.ts';

const root = document.createElement('div'); document.body.append(root);
let client: QueryClient;
const create = vi.fn(() => 'blob:cover-' + create.mock.calls.length), revoke = vi.fn();
const cover = '/api/v1/books/one/cover';
function Probe({ api, url = cover }: {api: ReaderApi; url?: string}) {
  const src = useCover(api, url);
  return src ? <img src={src} /> : <span>placeholder</span>;
}
function setup(load: (...args: any[]) => Promise<Uint8Array>) {
  create.mockClear(); revoke.mockClear();
  vi.stubGlobal('URL', class extends URL { static override createObjectURL = create; static override revokeObjectURL = revoke; });
  client = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  const api = {baseUrl:'https://reader.test',currentSession:()=>({user:{id:'a'}}),coverBytes:vi.fn(load)} as unknown as ReaderApi;
  const mount = (children: React.ReactNode) => act(() => render(<QueryClientProvider client={client}>{children}</QueryClientProvider>,root));
  return {api,mount};
}
afterEach(() => { act(() => render(null,root)); client.clear(); onlineManager.setOnline(true); vi.unstubAllGlobals(); });

it('shares the request and renders warm cache before paint when a view mounts again', async () => {
  const {api,mount} = setup(async()=>new Uint8Array([1]));
  mount(<><Probe api={api}/><Probe api={api}/></>);
  await vi.waitFor(()=>expect(root.querySelectorAll('img')).toHaveLength(2));
  expect(api.coverBytes).toHaveBeenCalledOnce();
  mount(null); expect(revoke).toHaveBeenCalledTimes(2);
  mount(<Probe api={api}/>);
  expect(root.querySelector('img')).not.toBeNull();
  expect(root.textContent).not.toContain('placeholder');
  expect(api.coverBytes).toHaveBeenCalledOnce();
});

it('shows persistent bytes while validation hangs and does not recreate the URL on 304', async () => {
  const bytes = new Uint8Array([1]); let finish!: (bytes:Uint8Array)=>void;
  const {api,mount} = setup((_url,_options,cached)=>{cached(bytes);return new Promise(resolve=>{finish=resolve;});});
  mount(<Probe api={api}/>);
  await vi.waitFor(()=>expect(root.querySelector('img')).not.toBeNull());
  expect(client.getQueryState(['book-cover',api.baseUrl,'a',cover])?.fetchStatus).toBe('fetching');
  const src = root.querySelector('img')!.src;
  await act(async()=>{finish(bytes);});
  await vi.waitFor(()=>expect(client.isFetching()).toBe(0));
  expect(root.querySelector('img')!.src).toBe(src);
  expect(create).toHaveBeenCalledOnce();
});

it('updates changed bytes without clearing a visible cover, then releases both URLs', async () => {
  let finish!: (bytes:Uint8Array)=>void;
  const {api,mount} = setup((_url,_options,cached)=>{cached(new Uint8Array([1]));return new Promise(resolve=>{finish=resolve;});});
  mount(<Probe api={api}/>);
  await vi.waitFor(()=>expect(root.querySelector('img')).not.toBeNull());
  const old = root.querySelector('img')!.src;
  await act(async()=>{finish(new Uint8Array([2]));});
  await vi.waitFor(()=>expect(root.querySelector('img')!.src).not.toBe(old));
  expect(root.textContent).not.toContain('placeholder'); expect(revoke).toHaveBeenCalledWith(old);
  mount(null); expect(revoke).toHaveBeenCalledTimes(2);
});

it('hides cached data after permission failure and does not reuse it for another account or server', async () => {
  let fail!: (error:unknown)=>void;
  const {api,mount} = setup((_url,_options,cached)=>{cached(new Uint8Array([1]));return new Promise((_resolve,reject)=>{fail=reject;});});
  mount(<Probe api={api}/>);
  await vi.waitFor(()=>expect(root.querySelector('img')).not.toBeNull());
  await act(async()=>{fail(new ApiError('forbidden','revoked'));});
  await vi.waitFor(()=>expect(root.querySelector('img')).toBeNull());
  vi.mocked(api.coverBytes).mockImplementation(()=>new Promise(()=>{}));
  api.currentSession = (()=>({user:{id:'b'}})) as ReaderApi['currentSession'];
  mount(<Probe api={api}/>); expect(root.querySelector('img')).toBeNull();
  api.currentSession = (()=>({user:{id:'a'}})) as ReaderApi['currentSession'];
  Object.defineProperty(api,'baseUrl',{value:'https://other.test'});
  mount(<Probe api={api}/>); expect(root.querySelector('img')).toBeNull();
});


it('keeps the same URL across warm 304 checks and refreshes fresh cache on reconnect', async () => {
  let changed = false;
  const {api,mount} = setup(async (_url,_options,cached) => {
    cached?.(new Uint8Array([1]));
    return new Uint8Array([changed ? 2 : 1]);
  });
  mount(<Probe api={api}/>);
  await vi.waitFor(()=>expect(client.isFetching()).toBe(0));
  await vi.waitFor(()=>expect(root.querySelector('img')).not.toBeNull());
  const src = root.querySelector('img')!.src;
  await act(async()=>{await client.invalidateQueries({queryKey:['book-cover']});});
  expect(root.querySelector('img')!.src).toBe(src);
  expect(create).toHaveBeenCalledOnce();
  onlineManager.setOnline(false); changed = true;
  await act(async()=>{onlineManager.setOnline(true);});
  await vi.waitFor(()=>expect(root.querySelector('img')!.src).not.toBe(src));
  expect(api.coverBytes).toHaveBeenCalledTimes(3);
  expect(create).toHaveBeenCalledTimes(2);
});
