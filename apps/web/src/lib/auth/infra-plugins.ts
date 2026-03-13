import "server-only";

import { dash, sentinel } from "@better-auth/infra";

type InfraAuthPlugin = ReturnType<typeof dash> | ReturnType<typeof sentinel>;

export function getInfraAuthPlugins(apiKey?: string): InfraAuthPlugin[] {
  const normalizedApiKey = apiKey?.trim();
  if (!normalizedApiKey) {
    return [];
  }

  return [
    dash({
      apiKey: normalizedApiKey,
    }),
    sentinel({
      apiKey: normalizedApiKey,
    }),
  ];
}
