// @vitest-environment jsdom
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { SourceEditorPage } from '../src/features/sources/pages/SourceEditorPage.tsx';
import { render } from '../src/shared/ui/render-root.ts';
import { notify } from '../src/ui/notifications.ts';

vi.mock('../src/ui/notifications.ts', () => ({ notify: vi.fn(), dismissNotice: vi.fn(), placeNotifications: vi.fn() }));

it('reports a save failure, preserves the draft and lets the user retry successfully', async () => {
  const root = document.createElement('div'); document.body.append(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const api = {
    baseUrl: 'http://fixture.test', sources: async () => [],
    sourceTypes: async () => [{ id: 'text', pluginId: 'test', label: '测试来源', capabilities: [] }],
    saveSource: vi.fn().mockRejectedValueOnce(new Error('保存失败，请重试')).mockResolvedValueOnce({}),
  };
  try {
    await act(async () => render(<RuntimeContext value={{ api } as any}><QueryClientProvider client={client}><MemoryRouter initialEntries={['/sources/manage/new']}><Routes>
      <Route path="/sources/manage/new" element={<SourceEditorPage />} />
      <Route path="/sources" element={<p>保存完成</p>} />
    </Routes></MemoryRouter></QueryClientProvider></RuntimeContext>, root));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    await act(async () => {
      const select = root.querySelector('select')!; select.value = 'test/text'; select.dispatchEvent(new Event('change', { bubbles: true }));
      const input = root.querySelector('input')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '保留的草稿');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(notify).toHaveBeenCalledWith('保存失败，请重试', { kind: 'error' });
    expect(root.querySelector('input')!.value).toBe('保留的草稿');
    await act(async () => { root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(api.saveSource).toHaveBeenLastCalledWith(null, { name: '保留的草稿', config: {}, pluginId: 'test', sourceType: 'text' });
    expect(root.textContent).toContain('保存完成');
  } finally {
    act(() => render(null, root)); client.clear(); root.remove(); vi.clearAllMocks();
  }
});
