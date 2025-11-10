import { useChannel } from "ably/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  type JobStatusData,
  jobStatusDataSchema,
  makeAgentJobsChannelName,
} from "@/lib/ably";

export default function useAgentJobStatusData(
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

  // Effect is necessary: Syncs local state when server data changes
  // This handles cases like navigation between jobs or server-side data refreshes
  // The real-time updates come via Ably below, but initial data must sync with props
  useEffect(() => {
    setJobStatusData(initialJobStatusData);
  }, [initialJobStatusData]);

  useChannel(makeAgentJobsChannelName(agentId, userId), (message) => {
    const parsedResult = jobStatusDataSchema.safeParse(message.data);
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
