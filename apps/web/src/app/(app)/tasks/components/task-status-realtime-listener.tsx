"use client";

import { ChannelProvider, useChannel } from "ably/react";
import { useRouter } from "next/navigation";

import DynamicAblyProvider from "@/contexts/alby-provider.dynamic";
import { makeUserTasksChannelName, taskEventDataSchema } from "@/lib/ably";

interface TaskStatusRealtimeListenerProps {
  userId: string;
  taskId: string;
}

function TaskStatusRealtimeListenerBody({
  userId,
  taskId,
}: TaskStatusRealtimeListenerProps) {
  const router = useRouter();

  useChannel(makeUserTasksChannelName(userId), (message) => {
    const parsedResult = taskEventDataSchema.safeParse(message.data);
    if (!parsedResult.success) {
      console.error(
        "Failed to parse TaskEventData from message",
        message,
        parsedResult.error,
      );
      return;
    }

    if (parsedResult.data.taskId !== taskId) {
      return;
    }

    router.refresh();
  });

  return null;
}

export function TaskStatusRealtimeListener(
  props: TaskStatusRealtimeListenerProps,
) {
  return (
    <DynamicAblyProvider>
      <ChannelProvider channelName={makeUserTasksChannelName(props.userId)}>
        <TaskStatusRealtimeListenerBody {...props} />
      </ChannelProvider>
    </DynamicAblyProvider>
  );
}
