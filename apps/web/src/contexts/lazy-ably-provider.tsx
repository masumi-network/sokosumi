"use client";

import { type ComponentType, type ReactNode, useState } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";

interface LazyAblyProviderProps {
  children: ReactNode;
}

/**
 * Mount-gated Ably island gate. Returns null until `ably-provider` loads, then
 * wraps children. Use as a sibling of paint-critical UI — not as an app-shell
 * parent — so Instant chrome is never blocked on the Ably chunk.
 * Multiple instances share one realtime client via `getAblyRealtimeClient()`.
 */
export default function LazyAblyProvider({ children }: LazyAblyProviderProps) {
  const [Provider, setProvider] = useState<ComponentType<{
    children: ReactNode;
  }> | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  useMountEffect(() => {
    let cancelled = false;
    void import("./ably-provider")
      .then((m) => {
        if (cancelled) {
          return;
        }
        setProvider(() => m.default);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setLoadError(
          new Error("Failed to load Ably provider", {
            cause: error,
          }),
        );
      });
    return () => {
      cancelled = true;
    };
  });

  if (loadError) {
    throw loadError;
  }

  // Do not mount children until AblyProvider is ready — ChannelProvider /
  // useChannel throw without Ably React context.
  if (!Provider) {
    return null;
  }

  return <Provider>{children}</Provider>;
}
