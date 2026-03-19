import { queryOptions } from "@tanstack/react-query";

import { UnAuthenticatedError } from "@/lib/auth/errors";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

export const getAgentInputSchemaQueryKey = (agentId: string) => [
  "agents",
  agentId,
  "input-schema",
];

/**
 * TanStack query options to get the input schema for an agent.
 * Uses the app Core API facade so browser/server transport stays internal.
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
      try {
        const result = await coreClient.getAgentInputSchema(agentId);
        return result.data;
      } catch (error) {
        if (error instanceof CoreApiRequestError && error.status === 401) {
          throw new UnAuthenticatedError();
        }

        throw new Error("Failed to fetch agent input schema");
      }
    },
  });
