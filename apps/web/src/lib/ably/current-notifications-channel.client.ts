"use client";

import { makeUserNotificationsChannelName } from "@sokosumi/utils";

import { getEnvPublicConfig } from "@/config/env.public";

export function makeCurrentUserNotificationsChannelName(
  userId: string,
): string {
  const env = getEnvPublicConfig();
  return makeUserNotificationsChannelName(userId, {
    network: env.NEXT_PUBLIC_NETWORK,
    vercelEnv: env.NEXT_PUBLIC_VERCEL_ENV,
    vercelGitCommitRef: env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF,
  });
}
