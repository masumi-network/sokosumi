import { useChannel } from "ably/react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import {
  JobIndicatorStatus,
  jobIndicatorStatusSchema,
  makeAgentJobsChannel,
} from "@/lib/ably";

export default function useAgentJobStatus(
  agentId: string,
  userId: string,
  currentJobId: string | null,
  initialJobIndicatorStatus: JobIndicatorStatus | null,
  refresh: boolean = false,
) {
  const pathname = usePathname();
  const router = useRouter();
  const [jobStatusData, setJobStatusData] = useState<JobIndicatorStatus | null>(
    initialJobIndicatorStatus,
  );

  useChannel(makeAgentJobsChannel(agentId, userId), (message) => {
    const parsedResult = jobIndicatorStatusSchema.safeParse(message.data);
    if (parsedResult.success) {
      const jobId = parsedResult.data.jobId;
      if (currentJobId && jobId !== currentJobId) {
        return;
      }
      setJobStatusData(parsedResult.data);
      if (refresh) {
        // check pathname is job details path
        if (pathname.startsWith(`/agents/${agentId}/jobs/${jobId}`)) {
          router.refresh();
        }
      }
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
