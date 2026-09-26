import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectCloseStatusCard } from "@/app/projects/components/project-close-status";
import type { ProjectCloseStatus } from "@/lib/clients/generated/core";

const { cancelOwedMock, refreshMock, retryMock, toastErrorMock } = vi.hoisted(
  () => ({
    cancelOwedMock: vi.fn(),
    refreshMock: vi.fn(),
    retryMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    dateTime: () => "Sep 14, 2026, 12:00 PM",
  }),
  useTranslations: () => (key: string, values?: { count?: number }) =>
    values?.count === undefined ? key : `${key}:${values.count}`,
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: vi.fn(),
  },
}));

vi.mock("@/lib/actions/project/action", () => ({
  cancelProjectCloseOwedWork: cancelOwedMock,
  retryProjectClose: retryMock,
}));

function buildStatus(
  overrides: Partial<ProjectCloseStatus> = {},
): ProjectCloseStatus {
  return {
    id: "123e4567-e89b-42d3-a456-426614174001",
    projectId: "123e4567-e89b-42d3-a456-426614174002",
    state: "CLOSING",
    cutoffAt: new Date("2026-09-14T10:00:00.000Z"),
    reason: null,
    attempts: 0,
    failure: null,
    completedAt: null,
    projectRevision: 4,
    owedOccurrenceCount: 2,
    ...overrides,
  };
}

describe("ProjectCloseStatusCard", () => {
  beforeEach(() => {
    cancelOwedMock.mockReset();
    refreshMock.mockReset();
    retryMock.mockReset();
    toastErrorMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["CLOSED", "CLOSE_FAILED"] as const)(
    "refreshes a closing project until it becomes %s",
    (state) => {
      vi.useFakeTimers();
      const { rerender, unmount } = render(
        <ProjectCloseStatusCard status={buildStatus()} />,
      );
      act(() => vi.advanceTimersByTime(5_000));
      expect(refreshMock).toHaveBeenCalledTimes(1);

      rerender(<ProjectCloseStatusCard status={buildStatus({ state })} />);
      expect(
        screen.getByRole("heading", { name: `status.${state}.title` }),
      ).toBeInTheDocument();
      if (state === "CLOSE_FAILED") {
        expect(
          screen.getByRole("button", { name: "recovery.retryAction" }),
        ).toBeInTheDocument();
      }
      act(() => vi.advanceTimersByTime(10_000));
      expect(refreshMock).toHaveBeenCalledTimes(1);

      rerender(<ProjectCloseStatusCard status={buildStatus()} />);
      act(() => vi.advanceTimersByTime(5_000));
      expect(refreshMock).toHaveBeenCalledTimes(2);
      unmount();
      act(() => vi.advanceTimersByTime(10_000));
      expect(refreshMock).toHaveBeenCalledTimes(2);
    },
  );

  it("shows closing progress with the owed occurrence count", () => {
    render(<ProjectCloseStatusCard status={buildStatus()} />);

    expect(
      screen.getByRole("heading", { name: "status.CLOSING.title" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("status.CLOSING.description:2"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "recovery.retryAction" }),
    ).not.toBeInTheDocument();
  });

  it("requires a reason before retrying a failed close", async () => {
    const user = userEvent.setup();
    retryMock.mockResolvedValue({});
    render(
      <ProjectCloseStatusCard
        status={buildStatus({
          state: "CLOSE_FAILED",
          failure: {
            scheduleId: "schedule-1",
            message: "The schedule could not be resolved.",
          },
        })}
      />,
    );

    expect(
      screen.getByText("The schedule could not be resolved."),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "recovery.retryAction" }),
    );
    await user.click(
      screen.getByRole("button", { name: "recovery.retryAction" }),
    );

    const reason = screen.getByRole("textbox", {
      name: "recovery.reasonLabel",
    });
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(reason).toHaveFocus();
    expect(retryMock).not.toHaveBeenCalled();

    await user.type(reason, "Reviewed the blocked schedule");
    await user.click(
      screen.getByRole("button", { name: "recovery.retryAction" }),
    );

    await waitFor(() =>
      expect(retryMock).toHaveBeenCalledWith({
        projectId: "123e4567-e89b-42d3-a456-426614174002",
        operationId: expect.stringMatching(/[0-9a-f-]{36}/),
        expectedProjectRevision: 4,
        reason: "Reviewed the blocked schedule",
      }),
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it("offers canceling owed work only for a failed Task Schedule", async () => {
    const user = userEvent.setup();
    cancelOwedMock.mockResolvedValue({});
    const { rerender } = render(
      <ProjectCloseStatusCard
        status={buildStatus({ state: "CLOSE_FAILED" })}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "recovery.cancelOwedAction" }),
    ).not.toBeInTheDocument();

    rerender(
      <ProjectCloseStatusCard
        status={buildStatus({
          state: "CLOSE_FAILED",
          failure: { scheduleId: "schedule-1", message: "Blocked" },
        })}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "recovery.cancelOwedAction" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "recovery.reasonLabel" }),
      "Cancel the blocked owed work",
    );
    await user.click(
      screen.getByRole("button", { name: "recovery.cancelOwedAction" }),
    );

    await waitFor(() =>
      expect(cancelOwedMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "123e4567-e89b-42d3-a456-426614174002",
          expectedProjectRevision: 4,
          reason: "Cancel the blocked owed work",
        }),
      ),
    );
  });

  it("describes failures without a Task Schedule as retry-only", () => {
    const { rerender } = render(
      <ProjectCloseStatusCard
        status={buildStatus({ state: "CLOSE_FAILED" })}
      />,
    );

    expect(
      screen.getByText("status.CLOSE_FAILED.descriptionRetryOnly"),
    ).toBeInTheDocument();

    rerender(
      <ProjectCloseStatusCard
        status={buildStatus({
          state: "CLOSE_FAILED",
          failure: { scheduleId: "schedule-1", message: "Blocked" },
        })}
      />,
    );
    expect(
      screen.getByText("status.CLOSE_FAILED.descriptionWithCancel"),
    ).toBeInTheDocument();
  });

  it("closes recovery when the authoritative close resumes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ProjectCloseStatusCard
        status={buildStatus({ state: "CLOSE_FAILED" })}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "recovery.retryAction" }),
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    rerender(<ProjectCloseStatusCard status={buildStatus()} />);

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("reuses an operation ID only when retrying the same recovery payload", async () => {
    const user = userEvent.setup();
    retryMock.mockRejectedValue(new Error("retry failed"));
    const { rerender } = render(
      <ProjectCloseStatusCard
        status={buildStatus({ state: "CLOSE_FAILED" })}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "recovery.retryAction" }),
    );
    const reason = screen.getByRole("textbox", {
      name: "recovery.reasonLabel",
    });
    await user.type(reason, "Reviewed the failure");
    const retryButton = screen.getByRole("button", {
      name: "recovery.retryAction",
    });

    await user.click(retryButton);
    await waitFor(() => expect(retryMock).toHaveBeenCalledTimes(1));
    rerender(
      <ProjectCloseStatusCard
        status={buildStatus({
          state: "CLOSE_FAILED",
          projectRevision: 5,
        })}
      />,
    );
    await user.click(retryButton);
    await waitFor(() => expect(retryMock).toHaveBeenCalledTimes(2));

    const firstOperationId = retryMock.mock.calls[0]?.[0].operationId;
    expect(retryMock.mock.calls[1]?.[0].operationId).toBe(firstOperationId);
    expect(retryMock.mock.calls[1]?.[0].expectedProjectRevision).toBe(5);

    await user.clear(reason);
    await user.type(reason, "Use a different recovery path");
    await user.click(retryButton);
    await waitFor(() => expect(retryMock).toHaveBeenCalledTimes(3));

    expect(retryMock.mock.calls[2]?.[0].operationId).not.toBe(firstOperationId);
    expect(refreshMock).toHaveBeenCalledTimes(3);
    expect(toastErrorMock).toHaveBeenLastCalledWith("recovery.error", {
      duration: Infinity,
    });
  });
});
