import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";
import type {
  WorkspaceCalendarItem,
  WorkspaceCalendarSource,
} from "@/lib/clients/generated/core";
import CalendarError from "../error";
import CalendarLoading from "../loading";
import {
  getCalendarItemDateKey,
  WorkspaceCalendar,
} from "./workspace-calendar";

const { getWorkspaceCalendarMock } = vi.hoisted(() => ({
  getWorkspaceCalendarMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    dateTime: (value: Date, options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-US", options).format(value),
  }),
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getWorkspaceCalendar: getWorkspaceCalendarMock,
  },
}));

const ITEMS: WorkspaceCalendarItem[] = [
  {
    id: "occurrence-1",
    taskId: "task-1",
    taskName: "Prepare release notes",
    taskStatus: "QUEUED",
    taskAssigneeId: "coworker-1",
    scheduledAt: new Date("2026-08-18T09:00:00.000Z"),
    originalScheduledAt: new Date("2026-08-18T09:00:00.000Z"),
    state: "PLANNED",
    sourceId: "project:project-1",
    sourceWorkspaceId: "workspace-1",
    sourceType: "PROJECT",
    sourceProjectId: "project-1",
    sourceAccuracy: "INFERRED",
    timeAccuracy: "APPROXIMATE",
  },
];

const CALENDAR_PAGE = {
  pagination: {
    cursor: null,
    limit: 100,
    total: 101,
    nextCursor: "cursor-2",
  },
  range: {
    from: new Date("2026-08-01T00:00:00.000Z"),
    to: new Date("2026-09-01T00:00:00.000Z"),
  },
};

const SOURCES: WorkspaceCalendarSource[] = [
  {
    sourceId: "workspace:workspace-1",
    sourceType: "WORKSPACE",
    displayName: "Ada's workspace",
    logoUrl: null,
    paletteToken: "blue",
  },
  {
    sourceId: "project:project-1",
    sourceType: "PROJECT",
    displayName: "Release planning",
    logoUrl: "https://example.com/release-planning.png",
    paletteToken: "violet",
  },
];

describe("WorkspaceCalendar", () => {
  it("uses the server-provided date when the URL has no date", () => {
    render(
      <NuqsTestingAdapter>
        <WorkspaceCalendar items={ITEMS} initialDate="2040-01-18" />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByText("January 2040")).toBeInTheDocument();
  });

  it("disables forward navigation beyond the supplied calendar horizon", () => {
    render(
      <NuqsTestingAdapter>
        <WorkspaceCalendar
          items={ITEMS}
          initialDate="2026-08-18"
          latestDate="2026-08-18"
        />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByRole("button", { name: "next" })).toBeDisabled();
  });

  it("groups offset-boundary timestamps by the calendar timezone", () => {
    expect(getCalendarItemDateKey(new Date("2026-08-18T00:30:00.000Z"))).toBe(
      "2026-08-18",
    );
  });

  it("renders source and accuracy labels with task navigation", () => {
    render(
      <NuqsTestingAdapter searchParams="?view=agenda&date=2026-08-18">
        <WorkspaceCalendar
          items={ITEMS}
          initialDate="2026-08-18"
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    expect(screen.getAllByTestId("calendar-agenda")).toHaveLength(2);
    expect(screen.getAllByText("Release planning")).toHaveLength(3);
    expect(screen.getAllByTestId("calendar-source-marker")).toHaveLength(4);
    expect(screen.getAllByText("accuracy.inferred")).toHaveLength(2);
    expect(screen.getAllByText("accuracy.approximate")).toHaveLength(2);
    expect(
      screen.getAllByRole("link", { name: /Prepare release notes/ })[0],
    ).toBeInTheDocument();
  });

  it("toggles individual catalog sources through the URL", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn();

    render(
      <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
        <WorkspaceCalendar
          items={ITEMS}
          initialDate="2026-08-18"
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    await user.click(screen.getByRole("button", { name: /Release planning/ }));

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    const updates = onUrlUpdate.mock.calls.map(([event]) =>
      event.searchParams.toString(),
    );
    expect(updates.join("&")).toContain("source=workspace%3Aworkspace-1");
    expect(screen.getByText("empty.title")).toBeInTheDocument();
  });

  it("persists view, date, source, status, and coworker filters in the URL", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn();

    render(
      <NuqsTestingAdapter
        searchParams="?view=month&date=2026-08-18"
        onUrlUpdate={onUrlUpdate}
      >
        <WorkspaceCalendar
          items={ITEMS}
          initialDate="2026-08-18"
          coworkers={[{ id: "coworker-1", name: "Ada" }]}
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    await user.click(screen.getByRole("button", { name: "view.week" }));
    await user.click(screen.getByRole("button", { name: "next" }));
    await user.click(screen.getByRole("button", { name: /Release planning/ }));
    await user.click(screen.getByLabelText("status.label"));
    await user.click(screen.getByRole("option", { name: "status.QUEUED" }));
    await user.click(screen.getByLabelText("coworker.label"));
    await user.click(screen.getByRole("option", { name: "Ada" }));

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    const updates = onUrlUpdate.mock.calls.map(([event]) =>
      event.searchParams.toString(),
    );
    const updatedQuery = updates.join("&");
    expect(updatedQuery).toContain("view=week");
    expect(updatedQuery).toContain("date=2026-");
    expect(updatedQuery).toContain("source=workspace%3Aworkspace-1");
    expect(updatedQuery).toContain("status=QUEUED");
    expect(updatedQuery).toContain("coworker=coworker-1");
  });

  it("falls back to the month view when a week is requested on mobile", () => {
    render(
      <NuqsTestingAdapter searchParams="?view=week&date=2026-08-18">
        <WorkspaceCalendar items={ITEMS} initialDate="2026-08-18" />
      </NuqsTestingAdapter>,
    );

    expect(screen.getAllByTestId("calendar-week")).toHaveLength(1);
    expect(screen.getAllByTestId("calendar-month")).toHaveLength(1);
    expect(screen.getByTestId("mobile-calendar-views")).not.toHaveTextContent(
      "view.week",
    );
  });

  it("loads and renders the next calendar page", async () => {
    const user = userEvent.setup();
    getWorkspaceCalendarMock.mockResolvedValue({
      data: [
        {
          ...ITEMS[0],
          id: "occurrence-2",
          taskId: "task-2",
          taskName: "Publish release notes",
        },
      ],
      meta: {
        pagination: {
          cursor: "cursor-2",
          limit: 100,
          total: 101,
          nextCursor: null,
        },
      },
    });

    render(
      <NuqsTestingAdapter searchParams="?view=agenda&date=2026-08-18">
        <WorkspaceCalendar
          items={ITEMS}
          initialDate="2026-08-18"
          {...CALENDAR_PAGE}
        />
      </NuqsTestingAdapter>,
    );

    await user.click(
      screen.getByRole("button", { name: "pagination.loadMore" }),
    );

    expect(
      await screen.findAllByRole("link", { name: /Publish release notes/ }),
    ).toHaveLength(2);
    expect(getWorkspaceCalendarMock).toHaveBeenCalledWith({
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      cursor: "cursor-2",
      limit: 100,
    });
  });

  it("shows an empty state after filters exclude all calendar items", () => {
    render(
      <NuqsTestingAdapter searchParams="?source=workspace%3Aworkspace-1">
        <WorkspaceCalendar
          items={ITEMS}
          initialDate="2026-08-18"
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByText("empty.title")).toBeInTheDocument();
  });

  it("renders loading and retry states", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    const { unmount } = render(<CalendarLoading />);

    expect(screen.getByLabelText("Loading calendar")).toBeInTheDocument();

    unmount();
    render(
      <CalendarError error={new Error("Core unavailable")} reset={reset} />,
    );

    await user.click(screen.getByRole("button", { name: "error.retry" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
