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

    expect(
      screen.getByRole("tablist", { name: "Schedule runs" }),
    ).toBeInTheDocument();
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

  it("names each occurrence list for a reader landing mid-page", async () => {
    const user = userEvent.setup();
    renderOccurrences({
      upcoming: {
        occurrences: [occurrence({ id: "occ_1" })],
        nextCursor: null,
      },
      history: {
        occurrences: [
          occurrence({
            id: "occ_past",
            state: "RELEASED",
            effectiveScheduledAt: new Date("2026-09-01T07:00:00.000Z"),
          }),
        ],
        nextCursor: null,
      },
    });

    expect(
      screen.getByRole("list", { name: "Upcoming runs" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByRole("list", { name: "Past runs" })).toBeInTheDocument();
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

  it("refreshes the route and appends nothing when the cursor expires", async () => {
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
    expect(screen.getByText("Sep 10, 9:00 AM")).toBeInTheDocument();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("stops the loading spinner for people who prefer reduced motion", async () => {
    const user = userEvent.setup();
    let finishRequest: ((value: { status: "stale" }) => void) | undefined;
    loadMoreMock.mockReturnValue(
      new Promise((resolve) => {
        finishRequest = resolve;
      }),
    );

    renderOccurrences({
      upcoming: {
        occurrences: [occurrence({ id: "occ_1" })],
        nextCursor: "cursor-2",
      },
    });

    const button = screen.getByRole("button", { name: "Load more" });
    await user.click(button);

    await waitFor(() => {
      expect(button.querySelector("svg")).toHaveClass(
        "motion-safe:animate-spin",
      );
    });
    expect(button.querySelector("svg")).not.toHaveClass("animate-spin");

    finishRequest?.({ status: "stale" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
  });

  it("does not ask again for the same doomed cursor while the refresh is in flight", async () => {
    const user = userEvent.setup();
    loadMoreMock.mockResolvedValue({ status: "stale" });

    renderOccurrences({
      upcoming: {
        occurrences: [occurrence({ id: "occ_1" })],
        nextCursor: "cursor-2",
      },
    });

    const button = screen.getByRole("button", { name: "Load more" });
    await user.click(button);

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
    expect(button).toBeDisabled();

    await user.click(button);
    expect(loadMoreMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("keeps Load more reachable on an empty page that has more to read", async () => {
    const user = userEvent.setup();
    loadMoreMock.mockResolvedValue({
      status: "ok",
      occurrences: [occurrence({ id: "occ_1" })],
      nextCursor: null,
    });

    renderOccurrences({
      upcoming: { occurrences: [], nextCursor: "cursor-2" },
    });

    expect(
      screen.getByText(
        "No upcoming runs. New runs appear here as the schedule projects them.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(screen.getByText("Sep 10, 9:00 AM")).toBeInTheDocument();
    });
  });

  it("dates a run from another year, judged in the run's own time zone", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-09T12:00:00.000Z"));

    try {
      renderOccurrences({
        upcoming: {
          occurrences: [
            occurrence({ id: "occ_this_year" }),
            occurrence({
              id: "occ_last_year",
              effectiveScheduledAt: new Date("2025-12-31T20:00:00.000Z"),
            }),
            occurrence({
              id: "occ_new_year_utc",
              timezone: "America/New_York",
              effectiveScheduledAt: new Date("2027-01-01T00:30:00.000Z"),
            }),
          ],
          nextCursor: null,
        },
      });

      expect(screen.getByText("Sep 10, 9:00 AM")).toBeInTheDocument();
      expect(screen.getByText("Dec 31, 2025, 9:00 PM")).toBeInTheDocument();
      // 2027-01-01T00:30Z is still 2026 in New York, so no year is added.
      expect(screen.getByText("Dec 31, 7:30 PM")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells the reader when another page could not be loaded, and logs why", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
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
        { duration: Infinity },
      );
    });
    expect(consoleError).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
    consoleError.mockRestore();
  });
});
