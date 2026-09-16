import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { patchNotificationsReadMock, refetchMock, optionalNotificationsMock } =
  vi.hoisted(() => ({
    patchNotificationsReadMock: vi.fn(),
    refetchMock: vi.fn(),
    optionalNotificationsMock: vi.fn(),
  }));

vi.mock("@/lib/clients/core.notifications.browser.client", () => ({
  notificationsBrowserClient: {
    patchNotificationsRead: patchNotificationsReadMock,
  },
}));

vi.mock("@/contexts/notification-provider", () => ({
  useOptionalNotifications: () => optionalNotificationsMock(),
}));

import { MarkNotificationsRead } from "./mark-notifications-read.client";

describe("MarkNotificationsRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patchNotificationsReadMock.mockResolvedValue({ data: { count: 1 } });
    refetchMock.mockResolvedValue(undefined);
    optionalNotificationsMock.mockReturnValue({ refetch: refetchMock });
  });

  /**
   * The whole point (SOK-916). A reader on the task's own page has dealt with
   * whatever the notification said, so the row must not survive to be
   * reminded about a day later.
   */
  it("marks the page's notifications read when it mounts", async () => {
    render(<MarkNotificationsRead kind="TASK" referenceId="task-1" />);

    await waitFor(() => {
      expect(patchNotificationsReadMock).toHaveBeenCalledWith({
        kind: "TASK",
        referenceId: "task-1",
      });
    });
  });

  it("refreshes the bell so its badge drops the rows it just read", async () => {
    render(<MarkNotificationsRead kind="JOB" referenceId="job-1" />);

    await waitFor(() => {
      expect(refetchMock).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Refetching costs a request on every task and job page open, and most
   * opens clear nothing. The count says whether anything actually changed.
   */
  it("leaves the bell alone when the page cleared nothing", async () => {
    patchNotificationsReadMock.mockResolvedValue({ data: { count: 0 } });

    render(<MarkNotificationsRead kind="TASK" referenceId="task-1" />);

    await waitFor(() => {
      expect(patchNotificationsReadMock).toHaveBeenCalledTimes(1);
    });
    expect(refetchMock).not.toHaveBeenCalled();
  });

  /**
   * Clearing a notification is housekeeping. A reader who came to look at a
   * task must still get the task, so a failure here costs them one stale row
   * and nothing else.
   */
  it("says nothing to the reader when the write fails", async () => {
    patchNotificationsReadMock.mockRejectedValue(new Error("core down"));

    const { container } = render(
      <MarkNotificationsRead kind="TASK" referenceId="task-1" />,
    );

    await waitFor(() => {
      expect(patchNotificationsReadMock).toHaveBeenCalledTimes(1);
    });
    expect(container).toBeEmptyDOMElement();
    expect(refetchMock).not.toHaveBeenCalled();
  });

  /**
   * Clearing the rows is the job; nudging the bell is a courtesy. A surface
   * that renders this outside the provider still clears, and must not lose its
   * whole page over the courtesy.
   */
  it("still clears the rows with no notification provider around it", async () => {
    optionalNotificationsMock.mockReturnValue(null);

    expect(() =>
      render(<MarkNotificationsRead kind="TASK" referenceId="task-1" />),
    ).not.toThrow();

    await waitFor(() => {
      expect(patchNotificationsReadMock).toHaveBeenCalledWith({
        kind: "TASK",
        referenceId: "task-1",
      });
    });
  });

  /**
   * The provider outlives this component, so a reader who opens a task and
   * moves on before the write lands must still get an honest badge. Skipping
   * the refresh on unmount would leave it counting rows that are now read.
   */
  it("refreshes the bell even when the reader has already moved on", async () => {
    let settle: (value: { data: { count: number } }) => void = () => {};
    patchNotificationsReadMock.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    const { unmount } = render(
      <MarkNotificationsRead kind="TASK" referenceId="task-1" />,
    );

    await waitFor(() => {
      expect(patchNotificationsReadMock).toHaveBeenCalledTimes(1);
    });

    unmount();
    settle({ data: { count: 1 } });

    await waitFor(() => {
      expect(refetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("marks the new task read when the reader moves to another one", async () => {
    const { rerender } = render(
      <MarkNotificationsRead kind="TASK" referenceId="task-1" />,
    );

    await waitFor(() => {
      expect(patchNotificationsReadMock).toHaveBeenCalledTimes(1);
    });

    rerender(<MarkNotificationsRead kind="TASK" referenceId="task-2" />);

    await waitFor(() => {
      expect(patchNotificationsReadMock).toHaveBeenLastCalledWith({
        kind: "TASK",
        referenceId: "task-2",
      });
    });
  });
});
