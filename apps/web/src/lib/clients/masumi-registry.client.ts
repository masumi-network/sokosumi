import "server-only";

import { createRegistryClient } from "@sokosumi/masumi/clients";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";

export const registryClient = (() => {
  return createRegistryClient(
    getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
    getEnvSecrets().REGISTRY_API_URL,
    getEnvSecrets().REGISTRY_API_KEY,
  );
})();
