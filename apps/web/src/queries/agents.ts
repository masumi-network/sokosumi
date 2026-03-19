import { queryOptions } from "@tanstack/react-query";

import { UnAuthenticatedError } from "@/lib/auth/errors";
import { createCoreApiClient } from "@/lib/clients/core.client";
import { getAgentsByIdInputSchema } from "@/lib/clients/generated/core";

export const getAgentInputSchemaQueryKey = (agentId: string) => [
  "agents",
  agentId,
  "input-schema",
];

/**
 * TanStack query options to get the input schema for an agent.
 * Uses the generated Core API client (OpenAPI). Must be used from a client
 * component (e.g. with useQuery).
 *
 * @param agentId - The agent ID to fetch the input schema for
 * @returns Query options for the agent input schema
 */
export const getAgentInputSchemaQueryOptions = (agentId: string) =>
  queryOptions({
    queryKey: getAgentInputSchemaQueryKey(agentId),
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const client = await createCoreApiClient();
      const result = await getAgentsByIdInputSchema({
        client,
        path: { id: agentId },
      });

      if (result.error) {
        if (result.response.status === 401) {
          throw new UnAuthenticatedError();
        }
        throw new Error("Failed to fetch agent input schema");
      }

      return result.data.data;
    },
  });
