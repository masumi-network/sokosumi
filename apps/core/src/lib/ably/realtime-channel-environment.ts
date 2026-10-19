import type { RealtimeChannelEnvironment } from "@sokosumi/utils";

import { getEnv } from "@/config/env";

/**
 * The one source of the environment every Ably channel name is built for:
 * publishing, token capabilities and occupancy reads all pass it (ADR 0055).
 */
export function getRealtimeChannelEnvironment(): RealtimeChannelEnvironment {
  const env = getEnv();
  return {
    network: env.NETWORK,
    vercelEnv: env.VERCEL_ENV,
    vercelGitCommitRef: env.VERCEL_GIT_COMMIT_REF,
  };
}
