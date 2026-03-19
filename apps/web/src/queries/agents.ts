import { inputSchemaSchema } from "@sokosumi/masumi/schemas";
import { queryOptions } from "@tanstack/react-query";

import { apiSuccessResponseSchema } from "@/lib/api/schemas";
import { UnAuthenticatedError } from "@/lib/auth/errors";

export const getAgentInputSchemaQueryKey = (agentId: string) => [
  "agents",
  agentId,
  "input-schema",
];

/**
 * TanStack query options to get the input schema for an agent.
 * Uses the app's same-origin internal route so browser auth stays on the web
 * domain. Must be used from a client component (e.g. with useQuery).
 *
 * @param agentId - The agent ID to fetch the input schema for
 * @returns Query options for the agent input schema
 */
export const getAgentInputSchemaQueryOptions = (agentId: string) =>
  queryOptions({
    queryKey: getAgentInputSchemaQueryKey(agentId),
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await fetch(
        `/api/internal/agents/${encodeURIComponent(agentId)}/input-schema`,
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        if (response.status === 401) {
          throw new UnAuthenticatedError();
        }

        throw new Error("Failed to fetch agent input schema");
      }

      const parsedResponse = apiSuccessResponseSchema.parse(
        await response.json(),
      );
      return inputSchemaSchema.parse(parsedResponse.data);
    },
  });
