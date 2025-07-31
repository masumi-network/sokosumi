import { useChannel } from "ably/react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import {
  JobStatusData,
  jobStatusDataSchema,
  makeAgentJobsChannel,
} from "@/lib/ably";

export default function useAgentJobStatus(
  agentId: string,
  userId: string,
  currentJobId: string | null,
  initialJobStatusData: JobStatusData | null,
  refresh: boolean = false,
) {
  const pathname = usePathname();
  const router = useRouter();
  const [jobStatusData, setJobStatusData] = useState<JobStatusData | null>(
    initialJobStatusData,
  );

  useChannel(makeAgentJobsChannel(agentId, userId), (message) => {
    const parsedResult = jobStatusDataSchema.safeParse(message.data);
    if (parsedResult.success) {
      const jobId = parsedResult.data.id;
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
