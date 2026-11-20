"use client";

import { useEffect, useEffectEvent, useRef } from "react";

/**
 * Reports each new query failure for the active query key while this observer
 * stays mounted. Unmounting or changing keys before an in-flight read rejects
 * skips reporting so an abandoned read never toasts on another screen.
 */
export function useQueryErrorReport<TError>(
  queryKeyHash: string,
  error: TError | null,
  errorUpdateCount: number,
  onError?: (error: TError) => void,
): void {
  const hasOnError = Boolean(onError);
  const report = useEffectEvent((err: TError) => {
    onError?.(err);
  });
  const lastSeenRef = useRef<{ keyHash: string; count: number }>({
    keyHash: queryKeyHash,
    count: errorUpdateCount,
  });

  useEffect(() => {
    const previous = lastSeenRef.current;
    lastSeenRef.current = { keyHash: queryKeyHash, count: errorUpdateCount };

    if (!hasOnError || error === null || errorUpdateCount === 0) {
      return;
    }
    // Switching onto a key that already failed while inactive snapshots its
    // error count without replaying a stale toast; only a fresh failure reports.
    if (previous.keyHash !== queryKeyHash) {
      return;
    }
    if (errorUpdateCount <= previous.count) {
      return;
    }
    report(error);
  }, [queryKeyHash, error, errorUpdateCount, hasOnError]);
}
