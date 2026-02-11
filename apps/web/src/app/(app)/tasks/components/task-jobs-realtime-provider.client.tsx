"use client";

import { ChannelProvider } from "ably/react";
import { type ReactNode } from "react";

import DynamicAblyProvider from "@/contexts/alby-provider.dynamic";

interface TaskJobsRealtimeProviderProps {
  children: ReactNode;
}

export function TaskJobsRealtimeProvider({
  children,
}: TaskJobsRealtimeProviderProps) {
  return <DynamicAblyProvider>{children}</DynamicAblyProvider>;
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
