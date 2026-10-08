import { useLayoutEffect, useState } from 'react';

export function useDelayedBusy(busy: boolean): boolean {
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => {
    setVisible(false);
    if (!busy) return;
    const timer = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(timer);
  }, [busy]);
  return busy && visible;
}

export function BusyIndicator({ busy, label = '加载中…' }: { busy: boolean; label?: string }) {
  const visible = useDelayedBusy(busy);
  return visible ? <span className="busy-indicator" role={label ? 'status' : undefined}><span className="busy-spinner" aria-hidden="true" />{label}</span> : null;
}
