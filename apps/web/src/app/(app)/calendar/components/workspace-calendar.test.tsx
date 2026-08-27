import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceCalendarItem } from "@/lib/clients/generated/core";
import CalendarError from "../error";
import CalendarLoading from "../loading";
import { WorkspaceCalendar } from "./workspace-calendar";

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    dateTime: (value: Date) => value.toISOString(),
  }),
  useTranslations: () => (key: string) => key,
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
    sourceWorkspaceId: "workspace-1",
    sourceType: "PROJECT",
    sourceProjectId: "project-1",
    sourceAccuracy: "INFERRED",
    timeAccuracy: "APPROXIMATE",
  },
];

describe("WorkspaceCalendar", () => {
  it("renders source and accuracy labels with task navigation", () => {
    render(
      <NuqsTestingAdapter searchParams="?view=agenda&date=2026-08-18">
        <WorkspaceCalendar items={ITEMS} />
      </NuqsTestingAdapter>,
    );

    expect(screen.getAllByTestId("calendar-agenda")).toHaveLength(2);
    expect(screen.getAllByText("source.PROJECT")).toHaveLength(2);
    expect(screen.getAllByText("accuracy.inferred")).toHaveLength(2);
    expect(screen.getAllByText("accuracy.approximate")).toHaveLength(2);
    expect(
      screen.getAllByRole("link", { name: /Prepare release notes/ })[0],
    ).toHaveAttribute("href", "/tasks/task-1");
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
          coworkers={[{ id: "coworker-1", name: "Ada" }]}
        />
      </NuqsTestingAdapter>,
    );

    await user.click(screen.getByRole("button", { name: "view.week" }));
    await user.click(screen.getByRole("button", { name: "next" }));
    await user.click(screen.getByLabelText("source.label"));
    await user.click(screen.getByRole("option", { name: "source.PROJECT" }));
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
    expect(updatedQuery).toContain("source=PROJECT");
    expect(updatedQuery).toContain("status=QUEUED");
    expect(updatedQuery).toContain("coworker=coworker-1");
  });

  it("renders a requested week view on mobile", () => {
    render(
      <NuqsTestingAdapter searchParams="?view=week&date=2026-08-18">
        <WorkspaceCalendar items={ITEMS} />
      </NuqsTestingAdapter>,
    );

    expect(screen.getAllByTestId("calendar-week")).toHaveLength(2);
    expect(screen.getByTestId("mobile-calendar-views")).not.toHaveTextContent(
      "view.week",
    );
  });

  it("shows an empty state after filters exclude all calendar items", () => {
    render(
      <NuqsTestingAdapter searchParams="?source=WORKSPACE">
        <WorkspaceCalendar items={ITEMS} />
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
