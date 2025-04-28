"use client";

import { useEffect, useState } from "react";

import { getJobsByAgentId } from "@/lib/db";
import { Job, JobStatus } from "@/prisma/generated/client";

const FINISHED_JOB_STATUSES: JobStatus[] = [
  JobStatus.PAYMENT_FAILED,
  JobStatus.COMPLETED,
  JobStatus.REFUND_RESOLVED,
  JobStatus.DISPUTE_RESOLVED,
];

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
    FINISHED_JOB_STATUSES.includes(job.status),
  );

  return { jobs, executedJobs, isLoading, error };
}
