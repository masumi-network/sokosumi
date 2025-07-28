"use client";

import Ably from "ably";
import { AblyProvider as DefaultAblyProvider } from "ably/react";

const client = new Ably.Realtime({
  authUrl: "/ably/auth",
  authMethod: "POST",
});

interface AblyProviderProps {
  children: React.ReactNode;
}

export default function AblyProvider({ children }: AblyProviderProps) {
  return <DefaultAblyProvider client={client}>{children}</DefaultAblyProvider>;
}
