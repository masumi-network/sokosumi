"use client";

import { useEffect, useState } from "react";

import { JobInputsDataSchemaType } from "@/lib/job-input";
import { getAgentInputSchema } from "@/lib/services";

export default function useAgentInputSchemaPromise(agentId: string) {
  const [inputSchemaPromise, setInputSchemaPromise] =
    useState<Promise<JobInputsDataSchemaType> | null>(null);

  useEffect(() => {
    if (!agentId) {
      setInputSchemaPromise(null);
    } else {
      setInputSchemaPromise(getAgentInputSchema(agentId));
    }
  }, [agentId]);

  return inputSchemaPromise;
}
