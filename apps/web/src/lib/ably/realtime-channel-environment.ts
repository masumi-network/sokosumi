import type { RealtimeChannelEnvironment } from "@sokosumi/utils";

import { getEnvPublicConfig } from "@/config/env.public";

/**
 * The deployment every Ably channel name in Web is built for. It must match
 * the Core that minted the token, which a preview's Web and Core share by
 * being built from the same branch (ADR 0055).
 */
export function getRealtimeChannelEnvironment(): RealtimeChannelEnvironment {
  const env = getEnvPublicConfig();
  return {
    network: env.NEXT_PUBLIC_NETWORK,
    vercelEnv: env.NEXT_PUBLIC_VERCEL_ENV,
    vercelGitCommitRef: env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF,
  };
}
