"use client";

import { useChannel } from "ably/react";
import { useState } from "react";

import {
  type JobStatusData,
  jobStatusDataSchema,
  makeAgentJobsChannelName,
} from "@/lib/ably";

export default function useAgentJobStatusData(
  agentId: string,
  userId: string,
  currentJobId: string | null,
) {
  const [jobStatusData, setJobStatusData] = useState<JobStatusData | null>(
    null,
  );

  useChannel(makeAgentJobsChannelName(agentId, userId), (message) => {
    const parsedResult = jobStatusDataSchema.safeParse(message.data);
    if (parsedResult.success) {
      const jobId = parsedResult.data.jobId;
      if (currentJobId && jobId !== currentJobId) {
        return;
      }
      setJobStatusData(parsedResult.data);
    } else {
      setJobStatusData(null);
      console.error(
        "Failed to parse JobStatus from message",
        message,
        parsedResult.error,
      );
    }
  });

  return jobStatusData;
}
