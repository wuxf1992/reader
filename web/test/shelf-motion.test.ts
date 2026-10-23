// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { animateShelfPositions, captureShelfPositions, resetShelfMotion } from '../src/features/shelf/shelf-motion.ts';
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
it('keeps the visible position and zero opacity when interrupting a new card', () => {
  const grid = document.createElement('div');
  grid.innerHTML = '<div class="book-card" data-shelf-book-id="one" style="opacity:0"></div>';
  document.body.append(grid);
  const card = grid.firstElementChild as HTMLElement;
  vi.spyOn(card, 'getBoundingClientRect').mockReturnValueOnce({ left: 42, top: 80 } as DOMRect).mockReturnValue({ left: 10, top: 20 } as DOMRect);
  const cancel = vi.fn();
  const animations = new Map([['one', { cancel } as unknown as Animation]]);
  Object.defineProperty(card, 'animate', { value: vi.fn() });
  const snapshot = captureShelfPositions(grid, animations);
  expect(snapshot.positions.get('one')).toEqual({ left: 42, top: 80, opacity: 0 });
  expect(card.style.transform).toBe('translate3d(32px, 60px, 0)');
  expect(card.style.opacity).toBe('0');
  expect(cancel).toHaveBeenCalledOnce();
  resetShelfMotion(grid, animations);
  expect(card.style.transform).toBe(''); expect(card.style.opacity).toBe('');
});
it('uses opacity without spatial movement when reduced motion is requested', () => {
  const grid = document.createElement('div');
  grid.innerHTML = '<div class="book-card" data-shelf-book-id="one"></div>';
  document.body.append(grid);
  const card = grid.firstElementChild as HTMLElement;
  const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => ({ cancel: vi.fn() }));
  Object.defineProperty(card, 'animate', { value: animate });
  animateShelfPositions(grid, { positions: new Map([['one', { left: 200, top: 300, opacity: .4 }]]), scrollLeft: 0, scrollTop: 0 }, new Map(), true);
  expect(animate.mock.calls[0]?.[0]).toEqual([{ opacity: .4, transform: 'none' }, { opacity: 1, transform: 'none' }]);
});
