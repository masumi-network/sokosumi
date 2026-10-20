"use client";

import { makeUserNotificationsChannelName } from "@sokosumi/utils";

import { getRealtimeChannelEnvironment } from "./realtime-channel-environment";

export function makeCurrentUserNotificationsChannelName(
  userId: string,
): string {
  return makeUserNotificationsChannelName(
    userId,
    getRealtimeChannelEnvironment(),
  );
}
