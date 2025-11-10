import "server-only";

import Ably from "ably";

import { getEnvSecrets } from "@/config/env.secrets";

export default async function createAuthTokenRequest(userId: string) {
  const client = new Ably.Rest(
    getEnvSecrets().ABLY_AGENT_JOBS_SUBSCRIBE_ONLY_KEY,
  );
  const tokenRequest = await client.auth.createTokenRequest({
    clientId: userId,
    capability: {
      [`agent_jobs:*:user_${userId}`]: ["subscribe"],
    },
  });
  return tokenRequest;
}
