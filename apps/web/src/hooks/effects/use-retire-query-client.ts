"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { retireQueryClient } from "@/queries/get-query-client";

/**
 * Cancels and clears a QueryClient once a newer session client replaces it, or
 * when the provider genuinely unmounts.
 *
 * Unmount retirement waits one microtask so React StrictMode's synchronous
 * cleanup-then-remount check never wipes the active client or SSR-hydrated data.
 */
export function useRetireQueryClient(client: QueryClient): void {
  const activeClientRef = useRef<QueryClient | null>(null);
  const mountedClientRef = useRef<QueryClient | null>(null);

  useEffect(() => {
    const previous = activeClientRef.current;
    activeClientRef.current = client;
    mountedClientRef.current = client;

    if (previous && previous !== client) {
      retireQueryClient(previous);
    }

    return () => {
      mountedClientRef.current = null;
      queueMicrotask(() => {
        if (
          mountedClientRef.current !== client &&
          activeClientRef.current === client
        ) {
          activeClientRef.current = null;
          retireQueryClient(client);
        }
      });
    };
  }, [client]);
}
