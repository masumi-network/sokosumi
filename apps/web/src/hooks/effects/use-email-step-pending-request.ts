"use client";

import { type RefObject, useEffect, useRef } from "react";

interface EmailStepPendingRequest {
  mountedRef: RefObject<boolean>;
  pendingRef: RefObject<AbortController | null>;
}

/**
 * Tracks mounted/active status and aborts any in-flight request for
 * `EmailStep` when unmounted or hidden by React `<Activity>`.
 */
export function useEmailStepPendingRequest(): EmailStepPendingRequest {
  const mountedRef = useRef(false);
  const pendingRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingRef.current?.abort();
    };
  }, []);

  return { mountedRef, pendingRef };
}
