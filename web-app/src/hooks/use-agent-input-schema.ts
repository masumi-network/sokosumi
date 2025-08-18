"use client";

import { useEffect, useState } from "react";

import { jobInputsDataSchema, JobInputsDataSchemaType } from "@/lib/job-input";

export default function useAgentInputSchema(agentId: string) {
  const [data, setData] = useState<JobInputsDataSchemaType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (agentId) {
      const fetchAgentInputSchema = async () => {
        try {
          setLoading(true);
          setError(null);
          const response = await fetch(
            `/api/v1/agents/${encodeURIComponent(agentId)}/input-schema`,
          );

          if (!response.ok) {
            try {
              const errorData = await response.json();
              console.error("Failed to fetch agent input schema:", errorData);
            } catch (jsonError) {
              console.error(
                "Could not parse fetch input schema error response as JSON:",
                jsonError,
              );
            }
            setError(new Error("Failed to fetch agent input schema"));
            return;
          }

          const json = await response.json();
          const parsedResult = jobInputsDataSchema().safeParse(json.data);
          if (!parsedResult.success) {
            setError(new Error("Failed to parse agent input schema"));
          } else {
            setData(parsedResult.data);
          }
        } catch (error) {
          console.error("Failed to fetch agent input schema", error);
          setError(
            new Error(
              error instanceof Error
                ? error.message
                : "Failed to fetch agent input schema",
            ),
          );
        } finally {
          setLoading(false);
        }
      };

      fetchAgentInputSchema();
    }

    return () => {
      setData(null);
      setError(null);
      setLoading(false);
    };
  }, [agentId]);

  return { data, loading, error };
}
