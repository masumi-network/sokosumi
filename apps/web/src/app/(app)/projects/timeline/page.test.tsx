import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ProjectsTimelineData } from "./projects-timeline-data";

const { loadMock, connectionMock } = vi.hoisted(() => ({
  loadMock: vi.fn(),
  connectionMock: vi.fn(async () => undefined),
}));

vi.mock("next/server", () => ({ connection: connectionMock }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: object) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  getFormatter: async () => ({
    dateTime: (date: Date) => date.toISOString().slice(0, 10),
  }),
  getTimeZone: async () => "UTC",
}));
vi.mock("@/components/back-link", () => ({
  BackLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/refresh-prefetched-page.client", () => ({
  RefreshPrefetchedPage: () => null,
}));
vi.mock("./projects-timeline-data", () => ({
  loadProjectsTimeline: loadMock,
}));

const { ProjectsTimelineContent } = await import("./page");

type Row = ProjectsTimelineData["rows"][number];

function weeks(first: Row["weeks"][number]) {
  return [first, ...Array.from({ length: 7 }, () => [])];
}

const QUIET: Row = {
  project: { id: "p2", name: "Quiet" },
  overdue: [],
  weeks: weeks([]),
  hasDueTasks: false,
};

function data(
  rows: Row[],
  cut: Partial<Pick<ProjectsTimelineData, "tasksCut" | "projectsCut">> = {},
): ProjectsTimelineData {
  return {
    today: "2026-11-25",
    rows,
    tasksCut: false,
    projectsCut: false,
    ...cut,
  };
}

describe("ProjectsTimelineContent", () => {
  it("shows each project's due Tasks as links and says when a project has none", async () => {
    loadMock.mockResolvedValue(
      data([
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
        QUIET,
      ]),
    );

    render(await ProjectsTimelineContent());

    expect(
      screen.getByRole("heading", { level: 1, name: "title" }),
    ).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("link", { name: "Launch" })).toHaveAttribute(
      "href",
      "/projects/p1",
    );
    expect(
      within(table).getByRole("link", { name: /Late brief/ }),
    ).toHaveAttribute("href", "/tasks/t0");
    // Three per cell, then the rest through the project's Tasks, by due day.
    expect(within(table).queryByRole("link", { name: /Task d/ })).toBeNull();
    expect(
      within(table).getByRole("link", { name: 'more {"count":1}' }),
    ).toHaveAttribute("href", "/tasks?projectId=p1&sort=dueOn");
    expect(within(table).getByText("noDueDates")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "back" })).toHaveAttribute(
      "href",
      "/projects",
    );
    // Its content loads ahead of a click, so the page never waits on the request.
    expect(connectionMock).not.toHaveBeenCalled();
  });

  it("lets a keyboard reach the table's sideways scroll, named by the table", async () => {
    loadMock.mockResolvedValue(data([QUIET]));

    render(await ProjectsTimelineContent());

    const scroller = screen.getByRole("region", { name: "caption" });
    expect(scroller).toHaveAttribute("tabindex", "0");
    expect(scroller).toContainElement(screen.getByRole("table"));
  });

  it("does not claim a project has nothing due when the read was cut", async () => {
    loadMock.mockResolvedValue(data([QUIET], { tasksCut: true }));

    render(await ProjectsTimelineContent());

    expect(screen.queryByText("noDueDates")).toBeNull();
    expect(screen.getByText("notAllLoaded")).toBeInTheDocument();
    expect(screen.getByText("tasksCut")).toBeInTheDocument();
  });

  it("says when more open projects exist than it shows", async () => {
    loadMock.mockResolvedValue(data([QUIET], { projectsCut: true }));

    render(await ProjectsTimelineContent());

    expect(screen.getByText("projectsCut")).toBeInTheDocument();
    expect(screen.queryByText("tasksCut")).toBeNull();
  });

  it("says when there are no open projects", async () => {
    loadMock.mockResolvedValue(data([]));

    render(await ProjectsTimelineContent());

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("empty.title")).toBeInTheDocument();
  });
});
