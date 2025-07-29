import "server-only";

import { Realtime } from "ably";

import { getEnvSecrets } from "@/config/env.secrets";

let client: Realtime;

export default function getClient() {
  if (!client) {
    client = new Realtime({
      key: getEnvSecrets().ABLY_AGENT_JOBS_PUBLISH_ONLY_KEY,
    });
  }
  return client;
}
