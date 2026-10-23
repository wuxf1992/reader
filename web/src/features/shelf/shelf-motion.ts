export interface ShelfPosition {
  left: number;
  top: number;
  opacity: number;
}

export interface ShelfSnapshot {
  positions: Map<string, ShelfPosition>;
  scrollLeft: number;
  scrollTop: number;
}

const cardsIn = (grid: HTMLElement) => [...grid.querySelectorAll<HTMLElement>('.book-card[data-shelf-book-id]')];

export function captureShelfPositions(grid: HTMLElement, animations: Map<string, Animation>): ShelfSnapshot {
  const positions = new Map<string, ShelfPosition>();
  for (const card of cardsIn(grid)) {
    const id = card.dataset.shelfBookId!;
    const visible = card.getBoundingClientRect();
    const opacity = Number(getComputedStyle(card).opacity);
    animations.get(id)?.cancel();
    animations.delete(id);
    if (card.dataset.shelfMotionFrozen) {
      card.style.removeProperty('transform');
      card.style.removeProperty('opacity');
      delete card.dataset.shelfMotionFrozen;
    }
    const base = card.getBoundingClientRect();
    const dx = visible.left - base.left, dy = visible.top - base.top;
    if (typeof card.animate === 'function' && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 || opacity < 0.999)) {
      card.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      if (opacity < 0.999) card.style.opacity = String(opacity);
      card.dataset.shelfMotionFrozen = 'true';
    }
    positions.set(id, { left: visible.left, top: visible.top, opacity });
  }
  for (const [id, animation] of animations) {
    animation.cancel();
    animations.delete(id);
  }
  return { positions, scrollLeft: grid.closest<HTMLElement>('.shelf')?.scrollLeft ?? 0, scrollTop: grid.closest<HTMLElement>('.shelf')?.scrollTop ?? 0 };
}

export function animateShelfPositions(
  grid: HTMLElement,
  before: ShelfSnapshot,
  animations: Map<string, Animation>,
  reducedMotion: boolean,
): void {
  const scroller = grid.closest<HTMLElement>('.shelf');
  const scrollX = (scroller?.scrollLeft ?? 0) - before.scrollLeft;
  const scrollY = (scroller?.scrollTop ?? 0) - before.scrollTop;
  for (const card of cardsIn(grid)) {
    const id = card.dataset.shelfBookId!;
    const prior = before.positions.get(id);
    card.style.removeProperty('transform');
    card.style.removeProperty('opacity');
    delete card.dataset.shelfMotionFrozen;
    const target = card.getBoundingClientRect();
    const start = prior ? { left: prior.left, top: prior.top, opacity: prior.opacity } : { left: target.left, top: target.top, opacity: 0 };
    const dx = start.left - scrollX - target.left;
    const dy = start.top - scrollY - target.top;
    const moved = Math.abs(dx) > 1 || Math.abs(dy) > 1;
    if (!card.animate) continue;
    if (prior && !moved && start.opacity >= 0.999) continue;
    const duration = reducedMotion ? 90 : 220;
    const animation = card.animate([
      { opacity: start.opacity, transform: !reducedMotion && prior && moved ? `translate3d(${dx}px, ${dy}px, 0)` : 'none' },
      { opacity: 1, transform: 'none' },
    ], { duration, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' });
    animations.set(id, animation);
    animation.onfinish = () => {
      if (animations.get(id) !== animation) return;
      animations.delete(id);
      animation.cancel();
    };
  }
}

export function resetShelfMotion(grid: HTMLElement, animations: Map<string, Animation>): void {
  for (const animation of animations.values()) animation.cancel();
  animations.clear();
  for (const card of cardsIn(grid)) {
    if (!card.dataset.shelfMotionFrozen) continue;
    card.style.removeProperty('transform');
    card.style.removeProperty('opacity');
    delete card.dataset.shelfMotionFrozen;
  }
}
