import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import type { AppRuntime } from '../runtime.ts';
import { RuntimeContext } from './runtime-context.tsx';
import { applyTheme } from '../../ui/settings.ts';
import { useSettingsStore } from '../../shared/stores/settings.store.ts';
import { PALETTES } from '../../render/theme.ts';

const readerColors = {
  '--mantine-color-body': 'var(--reader-paper)', '--mantine-color-text': 'var(--reader-ink)',
  '--mantine-color-dimmed': 'var(--reader-muted)', '--mantine-color-placeholder': 'var(--reader-muted)',
  '--mantine-color-anchor': 'var(--reader-accent)', '--mantine-color-default': 'var(--reader-surface)',
  '--mantine-color-default-color': 'var(--reader-ink)', '--mantine-color-default-border': 'var(--reader-line)',
  '--mantine-color-default-hover': 'var(--reader-line)',
};

export function AppProviders({ runtime, children }: { runtime: AppRuntime; children: ReactNode }) {
  const theme = useSettingsStore(state => state.settings.theme);
  useEffect(() => {
    const host = runtime.player.element;
    document.body.append(host);
    runtime.playback.start();
    return () => { runtime.playback.stop(); host.remove(); };
  }, [runtime]);
  useEffect(() => runtime.connect(), [runtime]);
  useLayoutEffect(() => {
    applyTheme(document.documentElement, theme);
  }, [theme]);
  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === 'hidden') void runtime.flush();
      else void runtime.api.renewSessionIfNeeded().catch(() => undefined);
    };
    const flush = () => { void runtime.flush(); };
    const online = () => { void runtime.api.renewSessionIfNeeded().catch(() => undefined); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', flush);
    window.addEventListener('online', online);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('online', online);
    };
  }, [runtime]);
  return <RuntimeContext value={runtime}>
    <QueryClientProvider client={runtime.queryClient}>
      <MantineProvider forceColorScheme={PALETTES[theme].scheme}
        cssVariablesResolver={() => ({ variables: {}, light: readerColors, dark: readerColors })}>
        <Notifications />{children}
      </MantineProvider>
    </QueryClientProvider>
  </RuntimeContext>;
}
