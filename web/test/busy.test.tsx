// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { render } from '../src/shared/ui/render-root.ts';
import { Button } from '../src/ui/toolkit.tsx';
import { BusyIndicator } from '../src/ui/busy.tsx';

const root = document.createElement('div');
afterEach(() => { act(() => render(null, root)); vi.useRealTimers(); });

it('keeps button size and accessible label while delaying its spinner, then clears it', () => {
  vi.useFakeTimers();
  act(() => render(<Button busy>保存</Button>, root));
  const button = root.querySelector('button')!;
  expect(button.disabled).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  act(() => { vi.advanceTimersByTime(99); });
  expect(button.querySelector('.busy-spinner')).toBeNull();
  act(() => { vi.advanceTimersByTime(1); });
  expect(button.querySelector('.busy-spinner')).not.toBeNull();
  expect(button.textContent).toBe('保存');
  act(() => render(<Button busy={false}>保存</Button>, root));
  expect(button.disabled).toBe(false);
  expect(button.querySelector('.busy-spinner')).toBeNull();
});

it('never shows a spinner after a fast operation or an unmount', () => {
  vi.useFakeTimers();
  act(() => render(<BusyIndicator busy />, root));
  act(() => { vi.advanceTimersByTime(50); });
  act(() => render(<BusyIndicator busy={false} />, root));
  act(() => { vi.advanceTimersByTime(100); });
  expect(root.textContent).toBe('');
  act(() => render(<BusyIndicator busy />, root));
  act(() => render(null, root));
  expect(vi.getTimerCount()).toBe(0);
});
