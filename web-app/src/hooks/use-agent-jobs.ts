"use client";

import { useEffect, useState } from "react";

import { FinalizedJobStatuses, getJobsByAgentId } from "@/lib/db";
import { Job } from "@/prisma/generated/client";

export default function useAgentJobs(agentId: string) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchJobs = async () => {
      setIsLoading(true);
      setJobs([]);
      setError(null);

      try {
        const jobs = await getJobsByAgentId(agentId);
        setJobs(jobs);
      } catch (err) {
        if (err instanceof Error) {
          setError(err);
        } else {
          setError(new Error("An unknown error occurred while fetching jobs"));
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchJobs();
  }, [agentId]);

  const executedJobs = jobs.filter((job) =>
    FinalizedJobStatuses.includes(job.status),
  );

  return { jobs, executedJobs, isLoading, error };
}
