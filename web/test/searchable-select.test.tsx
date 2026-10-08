// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { render } from '../src/shared/ui/render-root.ts';
import { SearchableSelect } from '../src/ui/searchable-select.tsx';

const root = document.createElement('div'); document.body.append(root);
afterEach(() => { act(() => render(null, root)); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps the searchable menu inside the viewport above and below its trigger', async () => {
  vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 600);
  let triggerTop = 540;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ top: triggerTop, bottom: triggerTop + 40, left: 250, width: 280 } as DOMRect));
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(280);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
  const changed = vi.fn();
  await act(async () => render(<SearchableSelect label="来源" value="a" options={[{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }]} onChange={changed} />, root));
  await act(async () => root.querySelector<HTMLButtonElement>('.searchable-select-trigger')!.click());
  const menu = root.querySelector<HTMLElement>('[role="listbox"]')!;
  expect(menu.style.top).toBe('334px');
  expect(menu.style.left).toBe('98px');
  expect(menu.style.maxHeight).toBe('320px');
  expect(document.activeElement).toBe(menu.querySelector('input'));
  triggerTop = 50;
  await act(async () => { window.dispatchEvent(new Event('resize')); });
  expect(menu.style.top).toBe('96px');
  await act(async () => {
    const input = menu.querySelector('input')!;
    input.value = '乙'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(menu.querySelectorAll('[role="option"]')).toHaveLength(1);
  await act(async () => menu.querySelector<HTMLButtonElement>('[role="option"]')!.click());
  expect(changed).toHaveBeenCalledWith('b');
  expect(root.querySelector('[role="listbox"]')).toBeNull();
});
