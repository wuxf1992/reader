import { ApiError } from '../api/errors.ts';

export interface OfflineReadBudget { timedOut: boolean }

/** A cached read must settle even when Wi-Fi reports online but never responds. */
export async function withOfflineTimeout<T>(request: Promise<T>, hasCache: boolean, budget?: OfflineReadBudget): Promise<T> {
  if (!hasCache) return request;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // shortcut: slow replies use this open's cache; add background revalidation if needed.
    // Leave shared token refresh running so a rotated token is not lost.
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        if (budget) budget.timedOut = true;
        reject(new ApiError('offline', '网络响应超时，使用本地缓存'));
      }, budget?.timedOut ? 0 : 3000);
    })]);
  } finally { clearTimeout(timeout); }
}
