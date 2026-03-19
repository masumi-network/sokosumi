"use client";

import { useQuery } from "@tanstack/react-query";

import { getAgentInputSchemaQueryOptions } from "@/queries/agents";

export default function useAgentInputSchema(agentId: string) {
  const query = useQuery({
    ...getAgentInputSchemaQueryOptions(agentId),
    enabled: !!agentId,
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error,
  };
}
