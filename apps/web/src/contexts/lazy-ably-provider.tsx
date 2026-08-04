"use client";

import { type ComponentType, type ReactNode, useState } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";

interface LazyAblyProviderProps {
  children: ReactNode;
}

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
