import { createClient } from "@hey-api/client-next";

import { getEnvSecrets } from "@/config/env.config";

export const getRegistryClient = () => {
  const registryClient = createClient({
    baseUrl: getEnvSecrets().REGISTRY_API_URL,
  });
  registryClient.setConfig({
    headers: { token: getEnvSecrets().REGISTRY_API_KEY },
  });
  return registryClient;
};
