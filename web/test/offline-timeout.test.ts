import { afterEach, expect, it, vi } from 'vitest';
import { withOfflineTimeout } from '../src/core/offline-timeout.ts';
import { ApiError } from '../src/api/errors.ts';

afterEach(() => vi.useRealTimers());

it('bounds a cached read and shares the remaining budget across sequential reads', async () => {
  vi.useFakeTimers();
  const budget = { timedOut: false };
  const pending = new Promise<never>(() => {});
  const first = expect(withOfflineTimeout(pending, true, budget)).rejects.toMatchObject({ kind: 'offline' });
  await vi.advanceTimersByTimeAsync(3000);
  await first;
  const second = expect(withOfflineTimeout(pending, true, budget)).rejects.toMatchObject({ kind: 'offline' });
  await vi.advanceTimersByTimeAsync(0);
  await second;
  expect(vi.getTimerCount()).toBe(0);
});

it('does not treat parsing or a slow first download as a network timeout for later progress reads', async () => {
  vi.useFakeTimers();
  const budget = { timedOut: false };
  expect(await withOfflineTimeout(Promise.resolve('metadata'), true, budget)).toBe('metadata');
  await vi.advanceTimersByTimeAsync(6000);
  const progress = withOfflineTimeout(new Promise(resolve => setTimeout(() => resolve('remote position'), 20)), true, budget);
  await vi.advanceTimersByTimeAsync(20);
  expect(await progress).toBe('remote position');
  expect(budget.timedOut).toBe(false);
});

it('does not impose the cached-read limit on a first download', async () => {
  vi.useFakeTimers();
  const result = withOfflineTimeout(new Promise(resolve => setTimeout(() => resolve('book'), 6000)), false);
  await vi.advanceTimersByTimeAsync(6000);
  expect(await result).toBe('book');
});

it('preserves authorization errors and cleans up successful requests', async () => {
  vi.useFakeTimers();
  const error = new ApiError('unauthorized', 'revoked');
  await expect(withOfflineTimeout(Promise.reject(error), true)).rejects.toBe(error);
  expect(await withOfflineTimeout(Promise.resolve('fresh'), true)).toBe('fresh');
  expect(vi.getTimerCount()).toBe(0);
});
