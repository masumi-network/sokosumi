import { useChannel } from "ably/react";
import { useState } from "react";

import { jobStatusDataSchema, makeJobStatusChannel } from "@/lib/ably";
import { JobStatus } from "@/lib/db";

export default function useJobStatus(
  jobId: string,
  initialJobStatus?: JobStatus | undefined,
) {
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(
    initialJobStatus ?? null,
  );

  useChannel(makeJobStatusChannel(jobId), (message) => {
    const parsedResult = jobStatusDataSchema.safeParse(message.data);
    if (parsedResult.success) {
      setJobStatus(parsedResult.data.jobStatus);
    } else {
      console.error(
        "Failed to parse JobStatus from message",
        message,
        parsedResult.error,
      );
    }
  });

  return jobStatus;
}
