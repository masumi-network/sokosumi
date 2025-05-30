import { createHash } from "crypto";

import { getEnvSecrets } from "@/config/env.config";

export const compareApiKeys = (apiKey: string) => {
  const envApiKey = getEnvSecrets().ADMIN_KEY;
  return createHash(apiKey) === createHash(envApiKey);
};
