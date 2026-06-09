import { SokosumiJobStatus } from "@sokosumi/utils";

import { getRestClient } from "./client";
import { makeAgentJobsChannelName, makeUserTasksChannelName } from "./utils";

interface JobStatusData {
  jobId: string;
  jobStatus: SokosumiJobStatus;
  jobStatusSettled: boolean;
}

interface PublishJobStatusDataInput extends JobStatusData {
  agentId: string;
  userId: string;
}

interface TaskEventData {
  taskId: string;
  eventType: "task_event";
}

interface PublishTaskEventDataInput extends TaskEventData {
  userId: string;
}

export async function publishTaskEventData({
  userId,
  taskId,
}: PublishTaskEventDataInput) {
  const client = getRestClient();
  const channel = client.channels.get(makeUserTasksChannelName(userId));
  await channel.publish("task_event", {
    taskId,
    eventType: "task_event",
  });
}

export async function publishJobStatusData({
  agentId,
  userId,
  jobId,
  jobStatus,
  jobStatusSettled,
}: PublishJobStatusDataInput) {
  const client = getRestClient();
  const channel = client.channels.get(
    makeAgentJobsChannelName(agentId, userId),
  );
  await channel.publish("job_status_data", {
    jobId,
    jobStatus,
    jobStatusSettled,
  });
}
