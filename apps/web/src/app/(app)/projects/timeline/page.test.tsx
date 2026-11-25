import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ProjectsTimelineData } from "./projects-timeline-data";

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }));

vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: object) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  getFormatter: async () => ({
    dateTime: (date: Date) => date.toISOString().slice(0, 10),
  }),
  getTimeZone: async () => "UTC",
}));
vi.mock("./projects-timeline-data", () => ({
  loadProjectsTimeline: loadMock,
}));

const { ProjectsTimelineContent } = await import("./page");

function weeks(first: ProjectsTimelineData["rows"][number]["weeks"][number]) {
  return [first, ...Array.from({ length: 7 }, () => [])];
}

describe("ProjectsTimelineContent", () => {
  it("shows each project's due Tasks as links and says when a project has none", async () => {
    loadMock.mockResolvedValue({
      rows: [
        {
          project: { id: "p1", name: "Launch" },
          overdue: [
            {
              id: "t0",
              name: "Late brief",
              href: "/tasks/t0",
              projectId: "p1",
              dueOn: "2026-11-02",
            },
          ],
          weeks: weeks(
            ["a", "b", "c", "d"].map((id) => ({
              id,
              name: `Task ${id}`,
              href: `/tasks/${id}`,
              projectId: "p1",
              dueOn: "2026-11-27",
            })),
          ),
          hasDueTasks: true,
        },
        {
          project: { id: "p2", name: "Quiet" },
          overdue: [],
          weeks: weeks([]),
          hasDueTasks: false,
        },
      ],
      truncated: false,
    } satisfies ProjectsTimelineData);

    render(await ProjectsTimelineContent());

    const table = screen.getByRole("table");
    expect(within(table).getByRole("link", { name: "Launch" })).toHaveAttribute(
      "href",
      "/projects/p1",
    );
    expect(
      within(table).getByRole("link", { name: /Late brief/ }),
    ).toHaveAttribute("href", "/tasks/t0");
    // Three per cell, then the rest through the project's task list.
    expect(within(table).queryByRole("link", { name: /Task d/ })).toBeNull();
    expect(
      within(table).getByRole("link", { name: 'more {"count":1}' }),
    ).toHaveAttribute("href", "/tasks?projectId=p1");
    expect(within(table).getByText("noDueDates")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "back" })).toHaveAttribute(
      "href",
      "/projects",
    );
  });

  it("says when there are no open projects", async () => {
    loadMock.mockResolvedValue({ rows: [], truncated: false });

    render(await ProjectsTimelineContent());

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("empty.title")).toBeInTheDocument();
  });
});
