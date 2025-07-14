import { createClient } from "@hey-api/client-next";

import { getEnvSecrets } from "@/config/env.secrets";
import type { Client as RegistryClient } from "@/lib/api/generated/registry/client/types";

export const getRegistryClient = (): RegistryClient => {
  const registryClient = createClient({
    baseUrl: getEnvSecrets().REGISTRY_API_URL,
  });
  registryClient.setConfig({
    headers: { token: getEnvSecrets().REGISTRY_API_KEY },
  });
  return registryClient as RegistryClient;
};
