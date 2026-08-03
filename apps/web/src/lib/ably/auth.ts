import "server-only";

import Ably from "ably";

import { getEnvSecrets } from "@/config/env.secrets";

export default async function createAuthTokenRequest(userId: string) {
  const client = new Ably.Rest(getEnvSecrets().ABLY_SUBSCRIBE_ONLY_KEY);
  const tokenRequest = await client.auth.createTokenRequest({
    clientId: userId,
    capability: {
      [`agent_jobs:*:user_${userId}`]: ["subscribe"],
      [`tasks:*:user_${userId}`]: ["subscribe"],
      [`notifications:*:user_${userId}`]: ["subscribe"],
      [`chat_rooms:*:user_${userId}`]: ["subscribe"],
    },
  });
  return tokenRequest;
}
