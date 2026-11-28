import type { MouseEvent, ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../../../ui/toolkit.tsx';

export function safeReturnPath(state: unknown): string | undefined {
  const value = (state as { returnTo?: unknown } | null)?.returnTo;
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : undefined;
}

export function useSourceBack(fallback = '/sources') {
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = safeReturnPath(location.state);
  const target = returnTo ?? fallback;
  const hasHistory =
    typeof window !== 'undefined' && typeof window.history.state?.idx === 'number' && window.history.state.idx > 0;
  const goBack = () => {
    if (hasHistory) navigate(-1);
    else navigate(target, { replace: true });
  };
  return { target, hasHistory, goBack };
}

/** The heading every 书源 page uses: back (honouring in-app history or returnTo), title, an optional subtitle and actions. */
export function SourcesHeader({
  title,
  subtitle,
  backTo = '/sources',
  actions,
}: {
  title: string;
  subtitle?: string;
  backTo?: string;
  actions?: ReactNode;
}) {
  const { target, hasHistory, goBack } = useSourceBack(backTo);

  const onBack = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!hasHistory || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    goBack();
  };

  return (
    <header className="sources-header">
      <Link className="icon-button" to={target} replace onClick={onBack} aria-label="返回" title="返回">
        <Icon name="chevron-left" />
      </Link>
      <div className="sources-header-text">
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions ?? <span aria-hidden="true" />}
    </header>
  );
}
