// @vitest-environment jsdom
import { act } from 'react';
import { render } from '../src/shared/ui/render-root.ts';
import { afterEach, expect, it, vi } from 'vitest';
import { Sheet } from '../src/ui/sheet.tsx';
const root = document.createElement('div'); document.body.append(root);
afterEach(() => { act(() => render(null, root)); vi.unstubAllGlobals(); });
function paint(busy = false, wide = false) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('min-width') && wide, addEventListener() {}, removeEventListener() {} }));
  const close = vi.fn();
  act(() => render(<Sheet title="设置" busy={busy} onClose={close}><input aria-label="测试输入" /></Sheet>, root));
  const dialog = root.querySelector('dialog')!;
  dialog.getBoundingClientRect = () => ({ height: 400 } as DOMRect);
  const pointer = (target: Element, type: string, y: number) => act(() => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0, clientY: y, clientX: 20 });
    target.dispatchEvent(event);
  });
  return { dialog, close, pointer, header: dialog.querySelector('header')! };
}
it('closes a mobile sheet when its title is pulled down, without requiring X or the backdrop', () => {
  const { dialog, close, pointer, header } = paint();
  pointer(header, 'pointerdown', 100); pointer(dialog, 'pointermove', 230);
  expect(dialog.style.getPropertyValue('--sheet-drag-y')).toBe('130px');
  pointer(dialog, 'pointerup', 230); expect(close).toHaveBeenCalledOnce();
});
it('keeps short pulls and cancelled gestures open and clears their preview', () => {
  const { dialog, close, pointer, header } = paint();
  pointer(header, 'pointerdown', 100); pointer(dialog, 'pointermove', 120); pointer(dialog, 'pointerup', 120);
  expect(close).not.toHaveBeenCalled(); expect(dialog.hasAttribute('data-dragging')).toBe(false);
  pointer(header, 'pointerdown', 100); pointer(dialog, 'pointermove', 240); pointer(dialog, 'pointercancel', 240);
  expect(close).not.toHaveBeenCalled(); expect(dialog.style.getPropertyValue('--sheet-drag-y')).toBe('');
});
it.each([{ busy: true, wide: false }, { busy: false, wide: true }])('does not dismiss busy or desktop sheets: %o', ({ busy, wide }) => {
  const { dialog, close, pointer, header } = paint(busy, wide);
  pointer(header, 'pointerdown', 100); pointer(dialog, 'pointermove', 240); pointer(dialog, 'pointerup', 240);
  expect(close).not.toHaveBeenCalled(); expect(dialog.hasAttribute('data-dragging')).toBe(false);
});
it('leaves scrolling and form controls to the panel body', () => {
  const { dialog, close, pointer } = paint();
  pointer(dialog.querySelector('input')!, 'pointerdown', 100); pointer(dialog, 'pointermove', 240); pointer(dialog, 'pointerup', 240);
  expect(close).not.toHaveBeenCalled(); expect(dialog.hasAttribute('data-dragging')).toBe(false);
});

it('dismisses only the top sheet when a nested sheet is dragged', () => {
  const { pointer } = paint();
  const parentClose = vi.fn(), childClose = vi.fn();
  act(() => render(<Sheet title="父面板" onClose={parentClose}><Sheet title="子面板" onClose={childClose}>内容</Sheet></Sheet>, root));
  const child = root.querySelector('dialog dialog')!;
  child.getBoundingClientRect = () => ({ height: 400 } as DOMRect);
  pointer(child.querySelector('header')!, 'pointerdown', 100); pointer(child, 'pointermove', 240); pointer(child, 'pointerup', 240);
  expect(childClose).toHaveBeenCalledOnce(); expect(parentClose).not.toHaveBeenCalled();
});
