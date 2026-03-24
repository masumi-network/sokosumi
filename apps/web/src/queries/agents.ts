import { inputSchemaSchema } from "@sokosumi/masumi/schemas";
import { queryOptions } from "@tanstack/react-query";

import { UnAuthenticatedError } from "@/lib/auth/errors";
import {
  CoreApiRequestError,
  coreClient,
} from "@/lib/clients/core.browser.client";

export const getAgentInputSchemaQueryKey = (agentId: string) => [
  "agents",
  agentId,
  "input-schema",
];

/**
 * TanStack query options to get the input schema for an agent.
 * Uses the browser Core client directly. Must be used from a client component
 * (e.g. with useQuery).
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
        const response = await coreClient.getAgentInputSchema(agentId);

        return inputSchemaSchema.parse(response.data);
      } catch (error) {
        if (error instanceof CoreApiRequestError && error.status === 401) {
          throw new UnAuthenticatedError();
        }

        throw new Error("Failed to fetch agent input schema");
      }
    },
  });
