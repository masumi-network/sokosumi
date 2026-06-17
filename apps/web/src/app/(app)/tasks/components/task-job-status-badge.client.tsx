"use client";

import { SokosumiJobStatus } from "@sokosumi/utils";
import { useChannel } from "ably/react";
import { useEffect, useState } from "react";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { jobStatusDataSchema } from "@/lib/ably";

interface TaskJobStatusBadgeProps {
  channelName: string;
  jobId: string;
  initialStatus: SokosumiJobStatus;
  className?: string;
}

export function TaskJobStatusBadge({
  channelName,
  jobId,
  initialStatus,
  className,
}: TaskJobStatusBadgeProps) {
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useChannel(channelName, (message) => {
    const parsedResult = jobStatusDataSchema.safeParse(message.data);
    if (!parsedResult.success) {
      console.error(
        "Failed to parse JobStatus from message",
        message,
        parsedResult.error,
      );
      return;
    }

    if (parsedResult.data.jobId !== jobId) {
      return;
    }

    setStatus(parsedResult.data.jobStatus);
  });

  return (
    <JobStatusBadge
      key={`${jobId}-${status}-real-time-badge`}
      status={status}
      className={className}
    />
  );
}
