// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { render } from '../src/shared/ui/render-root.ts';
import { act } from 'react';
import { ConfirmSheet, Sheet } from '../src/ui/sheet.tsx';
import { DialogView } from '../src/ui/dialog.tsx';

const root = document.createElement('div');
afterEach(() => { act(() => render(null, root)); root.remove(); vi.useRealTimers(); });
it('dismisses a tools-style modal only for an outside tap, and protects busy edits', async () => {
  document.body.append(root);
  const close = vi.fn();
  const mount = (busy = false) => act(() => render(<Sheet title="阅读工具" busy={busy} onClose={close}><button>内容</button></Sheet>, root));
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

it('waits for the shared exit once and restores a sheet whose close callback keeps it open', async () => {
  document.body.append(root);
  vi.useFakeTimers();
  const close = vi.fn();
  act(() => render(<Sheet title="设置" onClose={close}><button>内容</button></Sheet>, root));
  const dialog = root.querySelector<HTMLDialogElement>('dialog')!;
  const animation = { cancel: vi.fn() } as unknown as Animation;
  const animate = vi.fn(() => animation);
  Object.defineProperty(dialog, 'animate', { configurable: true, value: animate });
  act(() => dialog.querySelector<HTMLButtonElement>('.sheet-close')!.click());
  act(() => dialog.querySelector<HTMLButtonElement>('.sheet-close')!.click());
  expect(animate).toHaveBeenCalledOnce();
  expect(dialog.hasAttribute('data-closing')).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(149); });
  expect(close).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(close).toHaveBeenCalledOnce();
  expect(dialog.open).toBe(true);
  expect(dialog.hasAttribute('data-closing')).toBe(false);
});

it('cancels the exit if the sheet becomes busy before its callback', async () => {
  document.body.append(root);
  vi.useFakeTimers();
  const close = vi.fn();
  const mount = (busy: boolean) => act(() => render(<Sheet title="设置" busy={busy} onClose={close}><button>内容</button></Sheet>, root));
  mount(false);
  const dialog = root.querySelector<HTMLDialogElement>('dialog')!;
  const animation = { cancel: vi.fn() } as unknown as Animation;
  Object.defineProperty(dialog, 'animate', { configurable: true, value: vi.fn(() => animation) });
  act(() => dialog.querySelector<HTMLButtonElement>('.sheet-close')!.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(75); });
  mount(true);
  expect(dialog.hasAttribute('data-closing')).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(close).not.toHaveBeenCalled();
});

it('animates confirmation cancellation but executes destructive confirmation immediately', async () => {
  document.body.append(root);
  vi.useFakeTimers();
  const cancel = vi.fn(), confirm = vi.fn();
  act(() => render(<ConfirmSheet title="删除" text="确认？" onCancel={cancel} onConfirm={confirm} />, root));
  const dialog = root.querySelector<HTMLDialogElement>('dialog')!;
  Object.defineProperty(dialog, 'animate', { configurable: true, value: vi.fn(() => ({ cancel: vi.fn() })) });
  act(() => dialog.querySelector<HTMLButtonElement>('.primary')!.click());
  expect(confirm).toHaveBeenCalledOnce();
  act(() => dialog.querySelector<HTMLButtonElement>('.sheet-cancel')!.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(149); });
  expect(cancel).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(cancel).toHaveBeenCalledOnce();
});

it('animates prompt cancellation while preserving immediate save submission', async () => {
  document.body.append(root);
  vi.useFakeTimers();
  const close = vi.fn();
  act(() => render(<DialogView destructive="" dialog={{ kind: 'prompt', title: '重命名', value: '原名', resolve: () => {} }} onClose={close} />, root));
  const dialog = root.querySelector<HTMLDialogElement>('dialog')!;
  Object.defineProperty(dialog, 'animate', { configurable: true, value: vi.fn(() => ({ cancel: vi.fn() })) });
  act(() => dialog.querySelector<HTMLButtonElement>('.primary')!.click());
  expect(close).toHaveBeenLastCalledWith('原名');
  close.mockClear();
  act(() => [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '取消')!.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(149); });
  expect(close).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(close).toHaveBeenCalledWith(null);
});
