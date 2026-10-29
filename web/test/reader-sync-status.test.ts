// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import type { SyncStatus } from '../src/core/sync.ts';
import { ReaderScreen } from '../src/ui/reader-screen.tsx';

function readerStatus() {
  let current: SyncStatus = { state: 'idle', lastSyncAt: null, pending: false, message: '' };
  let listener!: () => void;
  const reader = {
    options: {
      sync: { status: () => current, onStatus: (update: () => void) => { listener = update; return vi.fn(); } },
      onSignedOut: vi.fn(),
    },
    chrome: { statusState: 'idle' }, listeners: [],
    paintNotes: vi.fn(), setStatus: vi.fn(), hideStatus: vi.fn(),
  };
  Reflect.apply(ReaderScreen.prototype['bindSyncStatus'], reader, []);
  return { reader, emit(state: SyncStatus['state'], message = '', pending = false) {
    current = { ...current, state, message, pending }; listener();
  } };
}

it('announces an offline period once across retries and further local progress writes', () => {
  const { reader, emit } = readerStatus();
  emit('offline');
  // Retrying after the toast has expired or been dismissed must stay quiet.
  for (let retry = 0; retry < 5; retry++) { emit('syncing'); emit('offline', '离线', true); }
  expect(reader.setStatus).toHaveBeenCalledTimes(1);
  expect(reader.setStatus).toHaveBeenCalledWith('offline', '离线 · 阅读进度存在本机');
});

it('announces the same sync error once but still reports a different error', () => {
  const { reader, emit } = readerStatus();
  for (let retry = 0; retry < 5; retry++) { emit('syncing'); emit('error', 'Bad Gateway'); }
  expect(reader.setStatus).toHaveBeenCalledTimes(1);
  emit('syncing'); emit('error', '服务端拒绝同步');
  expect(reader.setStatus).toHaveBeenLastCalledWith('error', '服务端拒绝同步');
  expect(reader.setStatus).toHaveBeenCalledTimes(2);
});

it('allows a new offline notice after successful sync and keeps refreshing notes', () => {
  const { reader, emit } = readerStatus();
  emit('offline', '', true); emit('syncing'); emit('idle');
  emit('syncing'); emit('idle');
  emit('offline', '', true);
  expect(reader.setStatus).toHaveBeenCalledTimes(2);
  expect(reader.setStatus).toHaveBeenLastCalledWith('offline', '离线 · 进度待同步');
  expect(reader.paintNotes).toHaveBeenCalledTimes(3);
});

it('still redirects when a sync response invalidates the session', () => {
  const { reader, emit } = readerStatus();
  emit('offline'); emit('syncing'); emit('signed-out', '登录已失效，请重新登录');
  expect(reader.options.onSignedOut).toHaveBeenCalledOnce();
});
