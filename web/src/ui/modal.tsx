import { type ComponentChildren, useLayoutEffect, useRef } from './vendor/preact.ts';
import { IconButton } from './toolkit.tsx';
import { placeNotifications } from './notifications.ts';

/** Native modal supplies focus containment and makes the background inert. */
export function Modal({ title, busy, onClose, children, className, dismissOnBackdrop = false }: {
  title: string; busy: boolean; onClose(): void; children: ComponentChildren; className?: string; dismissOnBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  function outside(event: MouseEvent): boolean {
    const rect = ref.current!.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  }
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    placeNotifications();
    return () => {
      if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
      placeNotifications();
      queueMicrotask(() => { if (previous?.isConnected) previous.focus({ preventScroll: true }); });
    };
  }, []);
  return <dialog ref={ref} className={['source-modal', className].filter(Boolean).join(' ')} aria-label={title} aria-busy={busy}
    onPointerDown={event => { pressedOutside.current = event.target === ref.current && outside(event); }}
    onClick={event => {
      if (dismissOnBackdrop && !busy && pressedOutside.current && event.target === ref.current && outside(event)) onClose();
      pressedOutside.current = false;
    }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const dialog = event.currentTarget;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="source-modal-header"><h2>{title}</h2><IconButton icon="close" label="关闭弹窗" disabled={busy} onClick={onClose} /></header>
    {children}
  </dialog>;
}
