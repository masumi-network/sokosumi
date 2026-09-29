"use client";

import { makeAgentJobsChannelName } from "@sokosumi/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChannelProvider, useChannel } from "ably/react";
import { MarkNotificationsRead } from "@/components/notifications/mark-notifications-read.client";
import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import { jobStatusDataSchema } from "@/lib/ably/schema";
import { useSession } from "@/lib/auth/auth.client";
import { getJobQueryKey, getJobQueryOptions } from "@/queries/jobs";
import JobDetailsView, { type JobDetailsViewProps } from "./job-details-view";

const JOB_STATUS_EVENT_NAME = "job_status_data";

export default function JobDetails({
  job: initialJob,
  ...viewProps
}: JobDetailsViewProps) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const { data: job } = useQuery({
    ...getJobQueryOptions(initialJob.id, session),
    enabled: !!session,
    initialData: initialJob,
  });

  const channelName = session?.user?.id
    ? makeAgentJobsChannelName(initialJob.agentId, session.user.id)
    : null;

  function handleStatusUpdate() {
    queryClient.invalidateQueries({
      queryKey: getJobQueryKey(initialJob.id),
    });
  }

  const detailsContent = <JobDetailsView job={job} {...viewProps} />;

  if (!channelName) {
    return detailsContent;
  }

  return (
    <>
      {detailsContent}
      {/* Opening the job is reading what its notifications were about. Both
          job surfaces render this component, so one call covers them. */}
      <MarkNotificationsRead kind="JOB" referenceId={initialJob.id} />
      <LazyAblyProvider>
        <ChannelProvider channelName={channelName}>
          <JobDetailsRealtimeListener
            channelName={channelName}
            jobId={initialJob.id}
            onStatusUpdate={handleStatusUpdate}
          />
        </ChannelProvider>
      </LazyAblyProvider>
    </>
  );
}

function JobDetailsRealtimeListener({
  channelName,
  jobId,
  onStatusUpdate,
}: {
  channelName: string;
  jobId: string;
  onStatusUpdate: () => void;
}) {
  useChannel(channelName, JOB_STATUS_EVENT_NAME, (message) => {
    const parsedResult = jobStatusDataSchema.safeParse(message.data);
    if (!parsedResult.success) {
      console.error("Failed to parse JobStatus from message", {
        channelName,
        messageName: message.name,
        messageData: message.data,
        error: parsedResult.error,
      });
      return;
    }

    if (parsedResult.data.jobId !== jobId) {
      return;
    }

    onStatusUpdate();
  });

  return null;
}
