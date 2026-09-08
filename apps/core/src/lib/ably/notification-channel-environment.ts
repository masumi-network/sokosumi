import type { NotificationChannelEnvironment } from "@sokosumi/utils";

import { getEnv } from "@/config/env";

export function getNotificationChannelEnvironment(): NotificationChannelEnvironment {
  const env = getEnv();
  return {
    network: env.NETWORK,
    vercelEnv: env.VERCEL_ENV,
    vercelGitCommitRef: env.VERCEL_GIT_COMMIT_REF,
  };
}
