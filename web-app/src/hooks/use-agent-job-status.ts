import { useChannel } from "ably/react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { jobStatusDataSchema, makeAgentJobsChannel } from "@/lib/ably";
import { JobStatus } from "@/lib/db";

export default function useAgentJobStatus(
  agentId: string,
  userId: string,
  currentJobId: string | null,
  initialJobStatus: JobStatus | null,
  refresh: boolean = false,
) {
  const pathname = usePathname();
  const router = useRouter();
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(
    initialJobStatus,
  );

  useChannel(makeAgentJobsChannel(agentId, userId), (message) => {
    const parsedResult = jobStatusDataSchema.safeParse(message.data);
    if (parsedResult.success) {
      const jobId = parsedResult.data.id;
      if (currentJobId && jobId !== currentJobId) {
        return;
      }
      setJobStatus(parsedResult.data.jobStatus);
      if (refresh) {
        // check pathname is job details path
        if (pathname.startsWith(`/agents/${agentId}/jobs/${jobId}`)) {
          router.refresh();
        }
      }
    } else {
      setJobStatus(null);
      console.error(
        "Failed to parse JobStatus from message",
        message,
        parsedResult.error,
      );
    }
  });

  return jobStatus;
}
