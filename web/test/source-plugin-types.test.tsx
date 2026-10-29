// @vitest-environment jsdom
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useSourceMutations, useSourceTypes } from '../src/features/sources/hooks/sourceQueries.ts';
import { render } from '../src/shared/ui/render-root.ts';

it.each(['enablePlugin', 'uninstallPlugin', 'installPlugin', 'uploadPlugin'] as const)('refreshes available source types after %s', async operation => {
  const root = document.createElement('div'); document.body.append(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let changed = false;
  const api = {
    baseUrl: 'http://fixture.test', sourceTypes: vi.fn(async () => changed ? [{ id: 'new', label: '更新后的来源类型' }] : []),
    [operation]: vi.fn(async () => { changed = true; return {}; }),
  };
  function View() {
    const types = useSourceTypes(), mutations = useSourceMutations();
    const invoke = {
      enablePlugin: () => mutations.enablePlugin.mutate({ id: 'plugin', enabled: true }),
      uninstallPlugin: () => mutations.uninstallPlugin.mutate('plugin'),
      installPlugin: () => mutations.installPlugin.mutate('plugin'),
      uploadPlugin: () => mutations.uploadPlugin.mutate(new File(['fixture'], 'plugin.tgz')),
    };
    return <><p>{types.data?.map(type => type.label).join(',') || '没有类型'}</p><button onClick={invoke[operation]}>执行</button></>;
  }
  try {
    await act(async () => render(<RuntimeContext value={{ api } as any}><QueryClientProvider client={client}><View /></QueryClientProvider></RuntimeContext>, root));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(root.textContent).toContain('没有类型');
    await act(async () => root.querySelector('button')!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(root.textContent).toContain('更新后的来源类型');
  } finally { act(() => render(null, root)); client.clear(); root.remove(); }
});
