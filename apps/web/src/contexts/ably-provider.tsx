"use client";

import Ably from "ably";
import { AblyProvider as DefaultAblyProvider } from "ably/react";
import { useMemo } from "react";

interface AblyProviderProps {
  children: React.ReactNode;
}

export default function AblyProvider({ children }: AblyProviderProps) {
  const client = useMemo(() => {
    return new Ably.Realtime({
      authUrl: "/api/ably/auth",
      authMethod: "POST",
    });
  }, []);

  return <DefaultAblyProvider client={client}>{children}</DefaultAblyProvider>;
}
