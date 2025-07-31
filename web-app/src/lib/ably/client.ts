import "server-only";

import { Rest } from "ably";

import { getEnvSecrets } from "@/config/env.secrets";

let restClient: Rest;

export function getRestClient() {
  if (!restClient) {
    restClient = new Rest({
      key: getEnvSecrets().ABLY_AGENT_JOBS_PUBLISH_ONLY_KEY,
    });
  }
  return restClient;
}
