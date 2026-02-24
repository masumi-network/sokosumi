import { createRegistryClient } from "@sokosumi/masumi/clients";

import { getEnv } from "@/config/env";

export const registryClient = (() => {
  const client = () =>
    createRegistryClient(
      getEnv().NETWORK,
      getEnv().REGISTRY_API_URL,
      getEnv().REGISTRY_API_KEY,
    );

  return client();
})();
