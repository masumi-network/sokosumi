"use client";

import { makeUserTasksChannelName } from "@sokosumi/utils";
import { ChannelProvider, useChannel } from "ably/react";
import { useRouter } from "next/navigation";
import { TASKS_ROUTE_REFRESH_DEBOUNCE_MS } from "@/app/tasks/constants";
import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import { useScheduledTimeout } from "@/hooks/effects/use-scheduled-timeout";
import { getRealtimeChannelEnvironment } from "@/lib/ably/realtime-channel-environment";

import { taskEventDataSchema } from "@/lib/ably/schema";

interface TaskStatusRealtimeListenerProps {
  userId: string;
  taskId: string;
}

function TaskStatusRealtimeListenerBody({
  userId,
  taskId,
}: TaskStatusRealtimeListenerProps) {
  const router = useRouter();
  const refreshTimeout = useScheduledTimeout();

  useChannel(
    makeUserTasksChannelName(userId, getRealtimeChannelEnvironment()),
    (message) => {
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

      refreshTimeout.schedule(
        () => router.refresh(),
        TASKS_ROUTE_REFRESH_DEBOUNCE_MS,
      );
    },
  );

  return null;
}

export function TaskStatusRealtimeListener(
  props: TaskStatusRealtimeListenerProps,
) {
  return (
    <LazyAblyProvider>
      <ChannelProvider
        channelName={makeUserTasksChannelName(
          props.userId,
          getRealtimeChannelEnvironment(),
        )}
      >
        <TaskStatusRealtimeListenerBody {...props} />
      </ChannelProvider>
    </LazyAblyProvider>
  );
}
