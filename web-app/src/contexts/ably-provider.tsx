"use client";

import Ably from "ably";
import { AblyProvider as DefaultAblyProvider } from "ably/react";
import { useMemo } from "react";

import ClientOnlyWrapper from "@/components/client-only-wrapper";

interface AblyProviderProps {
  children: React.ReactNode;
}

export default function AblyProvider({ children }: AblyProviderProps) {
  const client = useMemo(() => {
    return new Ably.Realtime({
      authUrl: "/ably/auth",
      authMethod: "POST",
    });
  }, []);

  return (
    <ClientOnlyWrapper>
      <DefaultAblyProvider client={client}>{children}</DefaultAblyProvider>
    </ClientOnlyWrapper>
  );
}
