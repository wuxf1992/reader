/**
 * The one overlay the app has.
 *
 * Every settings panel, edit form, picker, detail view and confirmation is a
 * `Sheet`. There used to be six ways to put something on top of a page — a native
 * modal centred on every viewport, a SweetAlert card, a div overlay, the reader's
 * half-screen panel, a floating card in the shelf's corner and two hand-written
 * media sheets — and each answered "where does it appear, how do I get out, where
 * does focus go" slightly differently. The rule is now one rule (docs/ui.md §3.7):
 *
 *  - Phones (≤700px): a bottom sheet with a grip, as tall as its content and never
 *    taller than the screen allows.
 *  - Wider windows: a drawer on the right edge; `size="wide"` gives forms that need
 *    it more width. `size="compact"` (confirmations, prompts, short pick lists) opens
 *    next to the tap or control that asked the question instead: a two-button
 *    question belongs where the hand already is, not across the window.
 *
 * It is a native `<dialog>` opened with `showModal()`: the top layer, an inert
 * background and Escape come from the platform. It is rendered in place rather than
 * in a portal so it inherits the theme of the screen that opened it (the reader's
 * 黑白灰, the media aliases) without each caller re-declaring it.
 *
 * The ✕ in the header, Escape, a backdrop tap and a mobile header pull all close
 * the sheet. `busy` disables every exit, so a save in flight cannot be abandoned
 * halfway.
 */

import { type JSX, type ReactNode, type PointerEvent as ReactPointerEvent, useLayoutEffect, useRef } from 'react';
import { Button, IconButton } from './toolkit.tsx';
import { placeNotifications } from './notifications.ts';
import '../styles/sheet.css';

export type SheetSize = 'regular' | 'compact' | 'wide';
export type SheetCloseRequest = (afterClose?: () => void) => void;
type SheetContent = ReactNode | ((requestClose: SheetCloseRequest) => ReactNode);

export interface SheetProps {
  title: string;
  onClose(): void;
  children: SheetContent;
  /** Disables every exit while a write is in flight. */
  busy?: boolean;
  /** A short readout beside the title, e.g. "128 章". */
  subtitle?: ReactNode;
  /** Extra header controls, placed before the close button. */
  actions?: ReactNode;
  /** A pinned action row; the body scrolls and this stays reachable. */
  footer?: SheetContent;
  size?: SheetSize;
  /** Content flavour only (e.g. `media-video-sheet`); geometry belongs to `.sheet`. */
  className?: string;
  /** A selector inside the sheet to focus on open. Defaults to the platform's choice. */
  initialFocus?: string;
  role?: 'dialog' | 'alertdialog';
}

export function Sheet({
  title, onClose, children, busy = false, subtitle, actions, footer,
  size = 'regular', className, initialFocus, role = 'dialog',
}: SheetProps): JSX.Element {
  const host = typeof window !== 'undefined'
    ? window.ReaderAndroid
      ? 'android'
      : typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
        ? 'pwa'
        : undefined
    : undefined;
  const ref = useRef<HTMLDialogElement>(null);
  /** Whether the platform opened it as a modal; without it Escape is ours to handle. */
  const native = useRef(false);
  /** A backdrop tap is a press *and* a release outside, so a drag out of a field is not a close. */
  const pressedOutside = useRef(false);
  const drag = useRef<{ id: number; y: number; at: number; distance: number } | null>(null);
  const state = useRef({ busy, onClose });
  state.current = { busy, onClose };
  const closing = useRef(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitAnimation = useRef<Animation | null>(null);

  const cancelExit = () => {
    if (exitTimer.current !== null) clearTimeout(exitTimer.current);
    exitTimer.current = null;
    exitAnimation.current?.cancel();
    exitAnimation.current = null;
    const dialog = ref.current;
    if (dialog) {
      dialog.removeAttribute('data-closing');
      dialog.getAnimations?.().forEach(animation => animation.cancel());
    }
    closing.current = false;
  };

  useLayoutEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    native.current = false;
    if (typeof dialog.showModal === 'function') {
      try { dialog.showModal(); native.current = true; } catch { dialog.setAttribute('open', ''); }
    } else {
      dialog.setAttribute('open', '');
    }
    const releaseScroll = containSheetScroll(dialog);
    if (initialFocus) dialog.querySelector<HTMLElement>(initialFocus)?.focus({ preventScroll: true });
    placeNotifications();
    // A compact sheet on a wide window opens where the hand is, not at the far edge.
    const anchor = size === 'compact' ? anchorPoint(previous) : null;
    const place = () => { if (anchor) placeNear(dialog, anchor); };
    place();
    if (anchor) addEventListener('resize', place);
    return () => {
      cancelExit();
      releaseScroll();
      if (anchor) removeEventListener('resize', place);
      if (typeof dialog.close === 'function' && dialog.open) dialog.close(); else dialog.removeAttribute('open');
      placeNotifications();
      queueMicrotask(() => { if (previous?.isConnected) previous.focus({ preventScroll: true }); });
    };
  }, []);

  useLayoutEffect(() => { if (busy && closing.current) cancelExit(); }, [busy]);

  const requestClose: SheetCloseRequest = (afterClose) => {
    if (state.current.busy || closing.current) return;
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.animate !== 'function') { (afterClose ?? (() => state.current.onClose()))(); return; }

    closing.current = true;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 80 : 150;
    const style = getComputedStyle(dialog);
    const rect = dialog.getBoundingClientRect();
    const desktop = matchMedia(WIDE).matches;
    const exitTransform = reduced ? style.transform : !desktop
      ? `translateY(${Math.ceil(rect.height)}px)`
      : dialog.dataset.size === 'compact' && dialog.hasAttribute('data-anchored') ? 'scale(.96)' : 'translateX(1rem)';
    dialog.setAttribute('data-closing', '');
    exitAnimation.current = dialog.animate([
      { opacity: style.opacity, transform: style.transform },
      { opacity: 0, transform: exitTransform },
    ], { duration, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
    exitTimer.current = setTimeout(() => {
      exitTimer.current = null;
      exitAnimation.current = null;
      (afterClose ?? (() => state.current.onClose()))();
      queueMicrotask(() => {
        if (ref.current !== dialog || !dialog.isConnected || !dialog.open) return;
        dialog.removeAttribute('data-closing');
        dialog.getAnimations?.().forEach(animation => animation.cancel());
        closing.current = false;
      });
    }, duration);
  };
  const resetDrag = () => {
    drag.current = null;
    ref.current?.removeAttribute('data-dragging');
    ref.current?.style.removeProperty('--sheet-drag-y');
  };
  useLayoutEffect(() => { if (busy) resetDrag(); }, [busy]);
  const startDrag = (event: ReactPointerEvent<HTMLDialogElement>) => {
    if (state.current.busy || closing.current || matchMedia(WIDE).matches || !event.isPrimary || event.button !== 0) return;
    const target = event.target as HTMLElement;
    // Only the grip/title owns a dismiss gesture; fields and body scrolling keep theirs.
    if (target.closest('dialog') !== event.currentTarget || !target.closest('.sheet-grip, .sheet-header') || target.closest('button, input, select, textarea, a')) return;
    event.currentTarget.getAnimations?.().forEach(animation => animation.cancel());
    drag.current = { id: event.pointerId, y: event.clientY, at: performance.now(), distance: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDialogElement>) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    active.distance = Math.max(0, event.clientY - active.y);
    if (active.distance < 6) return;
    event.preventDefault();
    event.currentTarget.setAttribute('data-dragging', '');
    event.currentTarget.style.setProperty('--sheet-drag-y', `${active.distance}px`);
  };
  const finishDrag = (event: ReactPointerEvent<HTMLDialogElement>) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    const dismiss = active.distance >= Math.min(100, event.currentTarget.getBoundingClientRect().height * .3)
      || active.distance >= 40 && performance.now() - active.at < 300;
    if (dismiss && !matchMedia(WIDE).matches) requestClose();
    resetDrag();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const outside = (event: { clientX: number; clientY: number; target: EventTarget; currentTarget: HTMLDialogElement }) => {
    if (event.target !== event.currentTarget) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  };

  return (
    <dialog
      ref={ref}
      className={className ? `sheet ${className}` : 'sheet'}
      data-size={size}
      data-host={host}
      role={role}
      aria-label={title}
      aria-busy={busy}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); requestClose(); }}
      onPointerDown={(event) => { pressedOutside.current = outside(event); startDrag(event); }}
      onPointerMove={moveDrag}
      onPointerUp={finishDrag}
      onPointerCancel={resetDrag}
      onLostPointerCapture={resetDrag}
      onClick={(event) => {
        if (pressedOutside.current && outside(event)) requestClose();
        pressedOutside.current = false;
      }}
      onKeyDown={(event) => {
        if (closing.current) { event.preventDefault(); event.stopPropagation(); return; }
        if (event.key === 'Escape') {
          // Keep the screen behind from reading the same key (the reader closes its
          // chrome on Escape); the platform's `cancel` event does the closing.
          event.stopPropagation();
          if (!native.current) requestClose();
          return;
        }
        if (event.key === 'Tab') trapTab(event.currentTarget, event);
      }}
    >
      <div className="sheet-grip" aria-hidden="true" />
      <header className="sheet-header">
        <h2>{title}</h2>
        {subtitle ? <span className="sheet-subtitle">{subtitle}</span> : null}
        {actions}
        <IconButton className="sheet-close" icon="close" label="关闭" disabled={busy} onClick={() => requestClose()} />
      </header>
      <div className="sheet-body">{typeof children === 'function' ? children(requestClose) : children}</div>
      {footer ? <footer className="sheet-footer">{typeof footer === 'function' ? footer(requestClose) : footer}</footer> : null}
    </dialog>
  );
}

// A short sheet has no scroll boundary for CSS overscroll containment to catch.
function containSheetScroll(dialog: HTMLDialogElement): () => void {
  let point: { x: number; y: number } | null = null, vertical: boolean | null = null;
  const owns = (target: EventTarget | null) => target instanceof Element && target.closest('dialog[open]') === dialog;
  const canScroll = (target: EventTarget | null, delta: number) => {
    for (let node = target instanceof Element ? target : null; node && node !== dialog; node = node.parentElement) {
      if (!(node instanceof HTMLElement) || !/^(auto|scroll)$/.test(getComputedStyle(node).overflowY)) continue;
      if (delta < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true;
    }
    return false;
  };
  const start = (event: TouchEvent) => {
    vertical = null;
    const touch = event.touches[0];
    point = owns(event.target) && event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const move = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!point || event.touches.length !== 1 || !touch || event.defaultPrevented) return;
    const dx = point.x - touch.clientX, dy = point.y - touch.clientY;
    // Ignore tap jitter; cancelling its first touchmove would swallow button clicks.
    if (vertical === null) {
      if (Math.hypot(dx, dy) < 6) return;
      vertical = Math.abs(dy) >= Math.abs(dx);
    }
    point = { x: touch.clientX, y: touch.clientY };
    // Horizontal controls and pinch zoom keep their native handling.
    if (vertical && dy && !canScroll(event.target, dy)) event.preventDefault();
  };
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.defaultPrevented && owns(event.target) && event.deltaY && !canScroll(event.target, event.deltaY)) event.preventDefault();
  };
  dialog.addEventListener('touchstart', start, { passive: true });
  dialog.addEventListener('touchmove', move, { passive: false });
  dialog.addEventListener('wheel', wheel, { passive: false });
  return () => {
    dialog.removeEventListener('touchstart', start);
    dialog.removeEventListener('touchmove', move);
    dialog.removeEventListener('wheel', wheel);
  };
}

/** The wide-window breakpoint; below it every sheet is a bottom sheet. */
const WIDE = '(min-width: 701px)';
const MARGIN = 16, GAP = 8;

/** The last press, so a compact sheet opened by a tap can appear beside that tap. */
let lastPress: { x: number; y: number; at: number } | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (event) => { lastPress = { x: event.clientX, y: event.clientY, at: Date.now() }; }, true);
}

interface Anchor { x: number; top: number; bottom: number }

/**
 * Where the opener is: the press that opened it, else the focused control (keyboard),
 * else nothing — and nothing keeps the CSS position (the top-right of the window).
 */
function anchorPoint(opener: HTMLElement | null): Anchor | null {
  if (typeof matchMedia !== 'function' || !matchMedia(WIDE).matches) return null;
  if (lastPress && Date.now() - lastPress.at < 1500) return { x: lastPress.x, top: lastPress.y, bottom: lastPress.y };
  if (opener && opener !== document.body && opener.isConnected) {
    const rect = opener.getBoundingClientRect();
    if (rect.width || rect.height) return { x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom };
  }
  return null;
}

/** Below the anchor if it fits, otherwise above it; always inside the window. */
function placeNear(dialog: HTMLDialogElement, anchor: Anchor): void {
  if (!matchMedia(WIDE).matches) { dialog.removeAttribute('data-anchored'); dialog.style.removeProperty('left'); dialog.style.removeProperty('top'); return; }
  dialog.setAttribute('data-anchored', '');
  const { width, height } = dialog.getBoundingClientRect();
  const left = Math.min(Math.max(MARGIN, anchor.x - width / 2), innerWidth - width - MARGIN);
  const below = anchor.bottom + GAP, above = anchor.top - GAP - height;
  const top = below + height <= innerHeight - MARGIN ? below : above >= MARGIN ? above : Math.max(MARGIN, innerHeight - height - MARGIN);
  dialog.style.left = `${Math.round(left)}px`;
  dialog.style.top = `${Math.round(top)}px`;
}

/** `showModal` makes the page inert but lets Tab leave for the browser chrome; keep it inside. */
function trapTab(dialog: HTMLDialogElement, event: { shiftKey: boolean; preventDefault(): void }): void {
  const controls = [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], summary, [tabindex]')]
    .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.closest('dialog') === dialog && element.getClientRects().length > 0);
  const first = controls[0], last = controls.at(-1);
  if (!first || !last) { event.preventDefault(); return; }
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey && (active === first || !controls.includes(active!))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
}

export interface ConfirmSheetProps {
  title?: string;
  text: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** The confirm button reads as destructive: delete, clear, discard. */
  danger?: boolean;
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

/**
 * A question with two answers, in the same sheet as everything else.
 *
 * Focus starts on 取消, so an Enter pressed out of habit does not delete anything.
 */
export function ConfirmSheet({
  title = '确认操作', text, confirmText = '确认', cancelText = '取消', danger = false, busy = false, onConfirm, onCancel,
}: ConfirmSheetProps): JSX.Element {
  return (
    <Sheet title={title} size="compact" role="alertdialog" busy={busy} onClose={onCancel} initialFocus=".sheet-cancel"
      footer={requestClose => <>
        <Button className="sheet-cancel" disabled={busy} onClick={() => requestClose(onCancel)}>{cancelText}</Button>
        <Button className={danger ? 'primary danger' : 'primary'} disabled={busy} onClick={onConfirm}>{confirmText}</Button>
      </>}>
      <p className="sheet-text">{text}</p>
    </Sheet>
  );
}
