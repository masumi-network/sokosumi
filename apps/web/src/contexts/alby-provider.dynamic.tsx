"use client";

import { type ComponentType, type ReactNode, useState } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";

interface DynamicAblyProviderProps {
  children: ReactNode;
}

export default function DynamicAblyProvider({
  children,
}: DynamicAblyProviderProps) {
  const [Provider, setProvider] = useState<ComponentType<{
    children: ReactNode;
  }> | null>(null);

  useMountEffect(() => {
    let cancelled = false;
    void import("./ably-provider").then((m) => {
      if (cancelled) {
        return;
      }
      setProvider(() => m.default);
    });
    return () => {
      cancelled = true;
    };
  });

  if (!Provider) {
    return children;
  }

  return <Provider>{children}</Provider>;
}
