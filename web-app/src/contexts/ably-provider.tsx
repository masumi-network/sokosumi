"use client";

import Ably from "ably";
import { AblyProvider as DefaultAblyProvider } from "ably/react";

import { getEnvPublicConfig } from "@/config/env.public";

const client = new Ably.Realtime({
  key: getEnvPublicConfig().NEXT_PUBLIC_ABLY_JOB_SUBSCRIBE_ONLY_KEY,
});

interface AblyProviderProps {
  children: React.ReactNode;
}

export function AblyProvider({ children }: AblyProviderProps) {
  return <DefaultAblyProvider client={client}>{children}</DefaultAblyProvider>;
}
