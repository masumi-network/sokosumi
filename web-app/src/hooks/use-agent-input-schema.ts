"use client";

import { useEffect, useState } from "react";

import { JobInputsDataSchemaType } from "@/lib/job-input";
import { getAgentInputSchema } from "@/lib/services";

export default function useAgentInputSchema(agentId: string) {
  const [data, setData] = useState<JobInputsDataSchemaType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (agentId) {
      setLoading(true);
      getAgentInputSchema(agentId)
        .then((schema) => {
          setData(schema);
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
