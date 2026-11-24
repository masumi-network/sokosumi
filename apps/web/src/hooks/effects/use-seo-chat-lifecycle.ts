"use client";

import { type RefObject, useLayoutEffect } from "react";

/**
 * Marks `useSeoChat` active before paint and retires its in-flight send and
 * pending attempt on unmount or React `<Activity>` hide.
 */
export function useSeoChatLifecycle(
  alive: RefObject<boolean>,
  controller: RefObject<AbortController | null>,
  pendingAttempt: RefObject<{ fingerprint: string; key: string } | null>,
): void {
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
      pendingAttempt.current = null;
    };
  }, []);
}
