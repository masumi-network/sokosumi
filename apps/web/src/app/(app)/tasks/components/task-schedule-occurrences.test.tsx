import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/../messages/en.json";
import type { TaskScheduleOccurrence } from "@/lib/clients/generated/core/types.gen";

const refreshMock = vi.fn();
const loadMoreMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, prefetch: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}));

vi.mock("@/app/tasks/actions", () => ({
  loadMoreTaskScheduleOccurrences: (...args: unknown[]) =>
    loadMoreMock(...args),
}));

import { TaskScheduleOccurrences } from "@/app/tasks/components/task-schedule-occurrences";

function occurrence(
  overrides: Partial<TaskScheduleOccurrence> & { id: string },
): TaskScheduleOccurrence {
  return {
    state: "PLANNED",
    scheduleVersion: 2,
    epochId: "44444444-4444-4444-8444-444444444444",
    originalScheduledAt: null,
    effectiveScheduledAt: new Date("2026-09-10T07:00:00.000Z"),
    timezone: "Europe/Berlin",
    isMissed: false,
    sourceId: "workspace:11111111-1111-4111-8111-111111111111",
    sourceWorkspaceId: "11111111-1111-4111-8111-111111111111",
    sourceType: "WORKSPACE",
    sourceProjectId: null,
    sourceAccuracy: "EXACT",
    timeAccuracy: "EXACT",
    releasedTask: null,
    ...overrides,
  };
}

function renderOccurrences(
  overrides: Partial<React.ComponentProps<typeof TaskScheduleOccurrences>> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TaskScheduleOccurrences
        taskId="task_1"
        upcoming={{ occurrences: [], nextCursor: null }}
        history={{ occurrences: [], nextCursor: null }}
        hasActiveSchedule
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
}

describe("TaskScheduleOccurrences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers Upcoming and History as accessible tabs, with Upcoming open first", () => {
    renderOccurrences();

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "Upcoming" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("switches to History from the keyboard", async () => {
    const user = userEvent.setup();
    renderOccurrences({
      history: {
        occurrences: [
          occurrence({
            id: "occ_history",
            state: "RELEASED",
            effectiveScheduledAt: new Date("2026-09-01T07:00:00.000Z"),
            releasedTask: {
              id: "task_run",
              name: "Morning digest",
              status: "COMPLETED",
              archivedAt: null,
            },
          }),
        ],
        nextCursor: null,
      },
    });

    await user.tab();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("link", { name: "Morning digest" }),
    ).toHaveAttribute("href", "/tasks/task_run");
  });

  it("renders upcoming run times in the occurrence time zone", () => {
    renderOccurrences({
      upcoming: {
        occurrences: [occurrence({ id: "occ_1" })],
        nextCursor: null,
      },
    });

    expect(screen.getByText("Sep 10, 9:00 AM")).toBeInTheDocument();
  });

  it("marks a moved occurrence inline instead of in its own region", () => {
    renderOccurrences({
      upcoming: {
        occurrences: [
          occurrence({
            id: "occ_moved",
            originalScheduledAt: new Date("2026-09-10T07:00:00.000Z"),
            effectiveScheduledAt: new Date("2026-09-10T09:00:00.000Z"),
          }),
        ],
        nextCursor: null,
      },
    });

    const row = screen.getByRole("listitem");
    expect(within(row).getByText("Sep 10, 11:00 AM")).toBeInTheDocument();
    expect(
      within(row).getByText("Moved from Sep 10, 9:00 AM"),
    ).toBeInTheDocument();
  });

  it("names skipped, canceled, and missed runs in text, not by color alone", async () => {
    const user = userEvent.setup();
    renderOccurrences({
      upcoming: {
        occurrences: [occurrence({ id: "occ_skipped", state: "SKIPPED" })],
        nextCursor: null,
      },
      history: {
        occurrences: [
          occurrence({
            id: "occ_canceled",
            state: "CANCELED",
            effectiveScheduledAt: new Date("2026-09-02T07:00:00.000Z"),
          }),
          occurrence({
            id: "occ_missed",
            state: "PLANNED",
            isMissed: true,
            effectiveScheduledAt: new Date("2026-09-01T07:00:00.000Z"),
          }),
        ],
        nextCursor: null,
      },
    });

    expect(screen.getByText("Skipped")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "History" }));

    expect(screen.getByText("Canceled")).toBeInTheDocument();
    expect(screen.getByText("Missed")).toBeInTheDocument();
  });

  it("keeps an archived released Task visible but not navigable", async () => {
    const user = userEvent.setup();
    renderOccurrences({
      history: {
        occurrences: [
          occurrence({
            id: "occ_archived",
            state: "RELEASED",
            releasedTask: {
              id: "task_archived",
              name: "Archived digest",
              status: "COMPLETED",
              archivedAt: new Date("2026-09-02T07:00:00.000Z"),
            },
          }),
        ],
        nextCursor: null,
      },
    });

    await user.click(screen.getByRole("tab", { name: "History" }));

    expect(screen.getByText("Archived digest")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Archived digest" })).toBeNull();
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("explains an empty Upcoming differently once the series was removed", async () => {
    const user = userEvent.setup();
    const { unmount } = renderOccurrences();

    expect(
      screen.getByText(
        "No upcoming runs. New runs appear here as the schedule projects them.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(
      screen.getByText(
        "No past runs. Released, canceled, and missed runs appear here.",
      ),
    ).toBeInTheDocument();
    unmount();

    renderOccurrences({ hasActiveSchedule: false });
    expect(
      screen.getByText("No upcoming runs — this schedule was removed."),
    ).toBeInTheDocument();
  });

  it("still shows preserved history for a removed series", async () => {
    const user = userEvent.setup();
    renderOccurrences({
      hasActiveSchedule: false,
      history: {
        occurrences: [
          occurrence({
            id: "occ_kept",
            state: "CANCELED",
            effectiveScheduledAt: new Date("2026-09-01T07:00:00.000Z"),
          }),
        ],
        nextCursor: null,
      },
    });

    await user.click(screen.getByRole("tab", { name: "History" }));

    expect(screen.getByText("Sep 1, 9:00 AM")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "No past runs. Released, canceled, and missed runs appear here.",
      ),
    ).toBeNull();
  });

  it("appends the next page and drops the button at the end of the view", async () => {
    const user = userEvent.setup();
    loadMoreMock.mockResolvedValue({
      status: "ok",
      occurrences: [
        occurrence({
          id: "occ_2",
          effectiveScheduledAt: new Date("2026-09-11T07:00:00.000Z"),
        }),
      ],
      nextCursor: null,
    });

    renderOccurrences({
      upcoming: {
        occurrences: [occurrence({ id: "occ_1" })],
        nextCursor: "cursor-2",
      },
    });

    await user.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(screen.getByText("Sep 11, 9:00 AM")).toBeInTheDocument();
    });
    expect(loadMoreMock).toHaveBeenCalledWith({
      taskId: "task_1",
      view: "upcoming",
      cursor: "cursor-2",
    });
    expect(screen.getByText("Sep 10, 9:00 AM")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("refreshes the route and keeps no stale pages when the cursor expires", async () => {
    const user = userEvent.setup();
    loadMoreMock.mockResolvedValue({ status: "stale" });

    renderOccurrences({
      upcoming: {
        occurrences: [occurrence({ id: "occ_1" })],
        nextCursor: "cursor-2",
      },
    });

    await user.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("tells the reader when another page could not be loaded", async () => {
    const user = userEvent.setup();
    loadMoreMock.mockRejectedValue(new Error("network"));

    renderOccurrences({
      upcoming: {
        occurrences: [occurrence({ id: "occ_1" })],
        nextCursor: "cursor-2",
      },
    });

    await user.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Unable to load more runs. Check your connection and try again.",
      );
    });
    expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
  });
});
