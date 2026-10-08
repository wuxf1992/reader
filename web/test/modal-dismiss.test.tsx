// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Modal } from '../src/ui/modal.tsx';

const root = document.createElement('div');
afterEach(() => { act(() => render(null, root)); root.remove(); });
it('dismisses a tools-style modal only for an outside tap, and protects busy edits', async () => {
  document.body.append(root);
  const close = vi.fn();
  const mount = (busy = false) => act(() => render(<Modal title="阅读工具" busy={busy} dismissOnBackdrop onClose={close}><button>内容</button></Modal>, root));
  await mount();
  const dialog = root.querySelector('dialog')!;
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 90, top: 40, bottom: 100 } as DOMRect);
  const tap = (down: number, up: number) => {
    dialog.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 20, clientY: down }));
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: up }));
  };
  tap(60, 60); tap(60, 20); expect(close).not.toHaveBeenCalled();
  tap(20, 20); expect(close).toHaveBeenCalledOnce();
  await mount(true); tap(20, 20); expect(close).toHaveBeenCalledOnce();
});
