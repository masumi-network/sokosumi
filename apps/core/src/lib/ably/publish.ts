import { getRestClient } from "./client";
import { makeUserTasksChannelName } from "./utils";

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
