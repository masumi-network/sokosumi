"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChannelProvider, useChannel } from "ably/react";
import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import { jobStatusDataSchema, makeAgentJobsChannelName } from "@/lib/ably";
import { useSession } from "@/lib/auth/auth.client";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";
import { getJobQueryKey, getJobQueryOptions } from "@/queries";

import JobDetailsView, { type JobDetailsViewProps } from "./job-details-view";

const JOB_STATUS_EVENT_NAME = "job_status_data";

export default function JobDetails({
  job: initialJob,
  organizations,
  personalWorkspaceLabel,
  projectName,
  readOnly = false,
  className,
  showAgentHeader = true,
  publicJobLayout = false,
}: JobDetailsViewProps & {
  organizations?: MemberWithOrganization[];
  personalWorkspaceLabel?: string;
  projectName?: string | null;
}) {
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

  const detailsContent = (
    <JobDetailsView
      job={job}
      organizations={organizations}
      personalWorkspaceLabel={personalWorkspaceLabel}
      projectName={projectName}
      readOnly={readOnly}
      className={className}
      showAgentHeader={showAgentHeader}
      publicJobLayout={publicJobLayout}
    />
  );

  if (!channelName) {
    return detailsContent;
  }

  return (
    <>
      {detailsContent}
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
