"use client";

import { useCallback, useEffect, useRef } from "react";

import { useLatestRef } from "./use-latest-ref";

interface PendingFrame {
  id: number;
  cancelled: boolean;
}

/**
 * Batches handler-pushed items into a single `requestAnimationFrame` callback,
 * cancelling any pending frame and dropping queued items on unmount.
 */
export function useAnimationFrameBatch<T>(
  onFlush: (items: T[]) => void,
): (item: T) => void {
  const onFlushRef = useLatestRef(onFlush);
  const pendingItemsRef = useRef<T[]>([]);
  const pendingFrameRef = useRef<PendingFrame | null>(null);

  useEffect(() => {
    return () => {
      pendingItemsRef.current = [];
      const frame = pendingFrameRef.current;
      if (frame !== null) {
        frame.cancelled = true;
        pendingFrameRef.current = null;
        window.cancelAnimationFrame(frame.id);
      }
    };
  }, []);

  return useCallback(
    (item: T) => {
      pendingItemsRef.current.push(item);

      if (pendingFrameRef.current !== null) {
        return;
      }

      const frame: PendingFrame = { id: 0, cancelled: false };
      frame.id = window.requestAnimationFrame(() => {
        if (frame.cancelled) {
          return;
        }
        if (pendingFrameRef.current === frame) {
          pendingFrameRef.current = null;
        }

        const items = pendingItemsRef.current;
        pendingItemsRef.current = [];
        if (items.length === 0) {
          return;
        }

        onFlushRef.current(items);
      });
      pendingFrameRef.current = frame;
    },
    [onFlushRef],
  );
}
