import { getEnvSecrets } from "@/config/env.secrets";
import { createClient } from "@/lib/api/generated/registry/client";

export const getRegistryClient = () => {
  const registryClient = createClient({
    baseUrl: getEnvSecrets().REGISTRY_API_URL,
  });
  registryClient.setConfig({
    headers: { token: getEnvSecrets().REGISTRY_API_KEY },
  });
  return registryClient;
};
