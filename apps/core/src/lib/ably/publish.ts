import { NotificationKind } from "@sokosumi/database";
import {
  makeAgentJobsChannelName,
  makeUserNotificationsChannelName,
  makeUserTasksChannelName,
  SokosumiJobStatus,
} from "@sokosumi/utils";

import { getRestClient } from "./client";

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

interface NotificationEventData {
  id: string;
  userId: string;
  kind: NotificationKind;
  referenceId: string;
  eventId: string;
  messageKey: string;
  messageParams: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

interface PublishNotificationEventInput {
  userId: string;
  notification: NotificationEventData;
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

export async function publishNotificationEvent({
  userId,
  notification,
}: PublishNotificationEventInput) {
  const client = getRestClient();
  const channel = client.channels.get(makeUserNotificationsChannelName(userId));
  await channel.publish("notification_created", notification);
}
