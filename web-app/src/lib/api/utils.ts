import { getEnvSecrets } from "@/config/env.secrets";
import { createHash } from "@/lib/utils";

export const compareApiKeys = (apiKey: string) => {
  const envApiKey = getEnvSecrets().ADMIN_KEY;
  return createHash(apiKey) === createHash(envApiKey);
};
