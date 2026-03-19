import { inputSchemaSchema } from "@sokosumi/masumi/schemas";
import { queryOptions } from "@tanstack/react-query";

import { getEnvPublicConfig } from "@/config/env.public";
import { UnAuthenticatedError } from "@/lib/auth/errors";

function normalizeCoreApiBaseUrl(baseUrl: string): string {
  const withoutTrailingSlash = baseUrl.replace(/\/+$/, "");
  return withoutTrailingSlash.endsWith("/v1")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/v1`;
}

export const getAgentInputSchemaQueryKey = (agentId: string) => [
  "agents",
  agentId,
  "input-schema",
];

/**
 * TanStack query options to get the input schema for an agent.
 * Must be used from a client component (e.g. with useQuery).
 *
 * @param agentId - The agent ID to fetch the input schema for
 * @returns Query options for the agent input schema
 */
export const getAgentInputSchemaQueryOptions = (agentId: string) =>
  queryOptions({
    queryKey: getAgentInputSchemaQueryKey(agentId),
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const baseUrl = normalizeCoreApiBaseUrl(
        getEnvPublicConfig().NEXT_PUBLIC_CORE_API_URL,
      );
      const response = await fetch(
        `${baseUrl}/agents/${encodeURIComponent(agentId)}/input-schema`,
        { credentials: "include" },
      );

      if (!response.ok) {
        if (response.status === 401) {
          throw new UnAuthenticatedError();
        }
        throw new Error("Failed to fetch agent input schema");
      }

      const body = (await response.json()) as { data?: unknown };
      const parsed = inputSchemaSchema.safeParse(body.data);
      if (!parsed.success) {
        throw new Error("Failed to parse agent input schema");
      }
      return parsed.data;
    },
  });
