"use client";

import { ChannelProvider } from "ably/react";
import type { ReactNode } from "react";

import LazyAblyProvider from "@/contexts/lazy-ably-provider";

interface TaskJobsRealtimeProviderProps {
  children: ReactNode;
}

export function TaskJobsRealtimeProvider({
  children,
}: TaskJobsRealtimeProviderProps) {
  return <LazyAblyProvider>{children}</LazyAblyProvider>;
}

interface TaskJobStatusChannelProviderProps {
  channelName: string;
  children: ReactNode;
}

export function TaskJobStatusChannelProvider({
  channelName,
  children,
}: TaskJobStatusChannelProviderProps) {
  return (
    <ChannelProvider channelName={channelName}>{children}</ChannelProvider>
  );
}
