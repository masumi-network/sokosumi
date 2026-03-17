import "@testing-library/jest-dom";
import { act, render } from "@testing-library/react";

import { TASKS_ROUTE_REFRESH_DEBOUNCE_MS } from "@/app/tasks/constants";
import { TaskStatusRealtimeListener } from "@/app/tasks/components/task-status-realtime-listener";

const refreshMock = jest.fn();
let channelCallback: null | ((message: { data: unknown }) => void) = null;

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

jest.mock("ably/react", () => ({
  ChannelProvider: ({ children }: { children: React.ReactNode }) => children,
  useChannel: (
    _channelName: string,
    callback: (message: { data: unknown }) => void,
  ) => {
    channelCallback = callback;
  },
}));

jest.mock("@/contexts/alby-provider.dynamic", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

describe("TaskStatusRealtimeListener", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    refreshMock.mockReset();
    channelCallback = null;
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("debounces route refreshes for repeated events on the same task", () => {
    render(<TaskStatusRealtimeListener userId="user-1" taskId="task-1" />);

    expect(channelCallback).not.toBeNull();

    act(() => {
      channelCallback?.({
        data: { taskId: "task-1", eventType: "task_event" },
      });
      channelCallback?.({
        data: { taskId: "task-1", eventType: "task_event" },
      });
      channelCallback?.({
        data: { taskId: "task-1", eventType: "task_event" },
      });
      jest.advanceTimersByTime(TASKS_ROUTE_REFRESH_DEBOUNCE_MS - 1);
    });

    expect(refreshMock).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("ignores events for other tasks", () => {
    render(<TaskStatusRealtimeListener userId="user-1" taskId="task-1" />);

    act(() => {
      channelCallback?.({
        data: { taskId: "task-2", eventType: "task_event" },
      });
      jest.advanceTimersByTime(TASKS_ROUTE_REFRESH_DEBOUNCE_MS);
    });

    expect(refreshMock).not.toHaveBeenCalled();
  });
});
