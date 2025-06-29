"use client";

import { useEffect, useState } from "react";

import { jobInputsDataSchema, JobInputsDataSchemaType } from "@/lib/job-input";

export default function useAgentInputSchema(agentId: string) {
  const [data, setData] = useState<JobInputsDataSchemaType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (agentId) {
      setLoading(true);
      fetch(`/api/agent/input-schema?agentId=${agentId}`)
        .then((response) => {
          if (!response.ok) {
            setError(new Error("Failed to get agent input schema"));
          }
          return response.json();
        })
        .then((schema) => {
          const parsedResult = jobInputsDataSchema().safeParse(schema);
          if (!parsedResult.success) {
            setError(new Error("Failed to parse agent input schema"));
          } else {
            setData(parsedResult.data);
          }
        })
        .catch((error) => {
          setError(error);
        })
        .finally(() => {
          setLoading(false);
        });
    }
    return () => {
      setData(null);
      setError(null);
      setLoading(false);
    };
  }, [agentId]);

  return { data, loading, error };
}
