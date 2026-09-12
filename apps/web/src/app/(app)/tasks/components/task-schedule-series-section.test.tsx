import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hasCurrentUserCalendarBetaAccessMock = vi.fn();
const listOccurrencesMock = vi.fn();
const occurrencesMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getFormatter: async () => ({
    dateTime: () => "Sep 10, 9:00 AM",
  }),
}));

vi.mock("@/lib/calendar-beta-access.server", () => ({
  hasCurrentUserCalendarBetaAccess: () =>
    hasCurrentUserCalendarBetaAccessMock(),
}));

vi.mock("@/lib/services/task-schedule.service", () => ({
  taskScheduleService: {
    listOccurrences: (...args: unknown[]) => listOccurrencesMock(...args),
  },
}));

vi.mock("@/app/tasks/components/task-schedule-occurrences", () => ({
  TaskScheduleOccurrences: (props: unknown) => {
    occurrencesMock(props);
    return <p>occurrence tabs</p>;
  },
}));

import { TaskScheduleSeriesSection } from "@/app/tasks/components/task-schedule-series-section";

const RECURRING_V2 = JSON.stringify({
  version: 2,
  epochId: "44444444-4444-4444-8444-444444444444",
  createdAt: "2026-09-01T07:00:00.000Z",
  ruleEffectiveFrom: "2026-09-01T07:00:00.000Z",
  timezone: "Europe/Berlin",
  mode: "recurring",
  expr: "0 9 * * *",
  endsMode: "never",
  epochReleaseCount: 3,
  anchorAt: "2026-09-01T07:00:00.000Z",
});

type SectionProps = Parameters<typeof TaskScheduleSeriesSection>[0];

function renderSection(
  overrides: Partial<SectionProps["task"]> = {},
  props: Partial<Omit<SectionProps, "task">> = {},
) {
  return TaskScheduleSeriesSection({
    task: {
      id: "task_1",
      metadata: RECURRING_V2,
      nextRunAt: new Date("2026-09-10T07:00:00.000Z"),
      scheduleRevision: 4,
      ...overrides,
    },
    workspaceName: "Acme Corp",
    forceReadOnly: false,
    projectPromise: Promise.resolve(null),
    ...props,
  });
}

function page(nextCursor: string | null = null, scheduleRevision = 4) {
  return { scheduleRevision, occurrences: [], nextCursor };
}

describe("TaskScheduleSeriesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasCurrentUserCalendarBetaAccessMock.mockResolvedValue(true);
    listOccurrencesMock.mockResolvedValue(page());
  });

  it("renders the series summary and the occurrence tabs", async () => {
    render(await renderSection());

    expect(screen.getByRole("link", { name: /Acme Corp/ })).toHaveAttribute(
      "href",
      "/calendar",
    );
    expect(screen.getByText("occurrence tabs")).toBeInTheDocument();
  });

  it("passes only the page data the tabs read across the boundary", async () => {
    listOccurrencesMock.mockResolvedValue(page("cursor-2"));

    render(await renderSection());

    expect(occurrencesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task_1",
        upcoming: { occurrences: [], nextCursor: "cursor-2" },
        history: { occurrences: [], nextCursor: "cursor-2" },
      }),
    );
  });

  it("keys the occurrence island on both independently read revisions", async () => {
    listOccurrencesMock
      .mockResolvedValueOnce(page(null, 4))
      .mockResolvedValueOnce(page(null, 5));

    const section = await renderSection();

    expect(section?.props.children.key).toBe("4:5");
  });

  it("keeps the series summary when the occurrence ledger read fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    listOccurrencesMock.mockRejectedValue(new Error("core down"));

    render(await renderSection());

    expect(screen.getByRole("link", { name: /Acme Corp/ })).toHaveAttribute(
      "href",
      "/calendar",
    );
    expect(screen.getByText("occurrencesError")).toBeInTheDocument();
    expect(screen.queryByText("occurrence tabs")).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("skips a Task that never carried a schedule without reading the ledger", async () => {
    const rendered = await renderSection({
      metadata: null,
      nextRunAt: null,
      scheduleRevision: 0,
    });

    expect(rendered).toBeNull();
    expect(listOccurrencesMock).not.toHaveBeenCalled();
  });

  it("skips the admin read-only route and viewers outside the Calendar beta", async () => {
    expect(await renderSection({}, { forceReadOnly: true })).toBeNull();

    hasCurrentUserCalendarBetaAccessMock.mockResolvedValue(false);
    expect(await renderSection()).toBeNull();
    expect(listOccurrencesMock).not.toHaveBeenCalled();
  });
});
