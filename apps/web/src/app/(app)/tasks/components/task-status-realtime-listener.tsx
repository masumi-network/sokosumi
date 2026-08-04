"use client";

import { ChannelProvider, useChannel } from "ably/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useDebouncedCallback } from "use-debounce";

import { TASKS_ROUTE_REFRESH_DEBOUNCE_MS } from "@/app/tasks/constants";
import LazyAblyProvider from "@/contexts/lazy-ably-provider";
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
  const refreshRoute = useDebouncedCallback(
    () => router.refresh(),
    TASKS_ROUTE_REFRESH_DEBOUNCE_MS,
  );

  useEffect(() => {
    return () => {
      refreshRoute.cancel();
    };
  }, [refreshRoute]);

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

    refreshRoute();
  });

  return null;
}

export function TaskStatusRealtimeListener(
  props: TaskStatusRealtimeListenerProps,
) {
  return (
    <LazyAblyProvider>
      <ChannelProvider channelName={makeUserTasksChannelName(props.userId)}>
        <TaskStatusRealtimeListenerBody {...props} />
      </ChannelProvider>
    </LazyAblyProvider>
  );
}
