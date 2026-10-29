import type {
  ProjectListItem,
  TaskActivitySummary,
} from "@sokosumi/core-client";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Echoes the key with its values, so a row's copy names what it chose.
function translate(key: string, values?: Record<string, unknown>): string {
  return values ? `${key}:${JSON.stringify(values)}` : key;
}

vi.mock("next-intl/server", () => ({
  getTranslations: async () => translate,
  getFormatter: async () => ({
    relativeTime: () => "2h ago",
    dateTime: () => "Oct 23",
  }),
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { getProjectById: vi.fn() },
}));

import { HomeProjectsPanel, HomeTeamDayPanel } from "./home-panels";

const HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000);

function project(id: string, overrides: Partial<ProjectListItem> = {}) {
  return {
    id,
    name: `Project ${id}`,
    logo: null,
    starredAt: null,
    taskCount: 2,
    jobCount: 1,
    createdAt: HOURS_AGO,
    lastActivityAt: HOURS_AGO,
    ...overrides,
  } as ProjectListItem;
}

const summary: TaskActivitySummary = {
  since: HOURS_AGO,
  completed: 3,
  awaitingInput: 0,
  createdByOtherHumans: 0,
  workedMinutes: 45,
  previous: { completed: 0, createdByOtherHumans: 0, workedMinutes: 0 },
};

afterEach(cleanup);

describe("HomeProjectsPanel", () => {
  it("lists each project with its counts and links it and the full list", async () => {
    render(
      await HomeProjectsPanel({
        feed: Promise.resolve([
          project("p1", { starredAt: HOURS_AGO }),
          project("p2"),
        ]),
      }),
    );

    const rows = screen.getAllByTestId("home-projects-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("link")).toHaveAttribute(
      "href",
      "/projects/p1",
    );
    expect(rows[0]).toHaveTextContent(
      'detail:{"pinned":"true","tasks":2,"jobs":1}',
    );
    expect(rows[1]).toHaveTextContent('"pinned":"false"');
    expect(screen.getByRole("link", { name: "showAll" })).toHaveAttribute(
      "href",
      "/projects",
    );
  });

  it("offers New project, in the list's own empty copy, when there are none", async () => {
    render(await HomeProjectsPanel({ feed: Promise.resolve([]) }));

    expect(screen.getByTestId("home-projects-empty")).toHaveTextContent(
      "empty.title",
    );
    expect(screen.getByRole("link", { name: "empty.action" })).toHaveAttribute(
      "href",
      "/projects?create=true",
    );
  });

  it("says the feed failed rather than that there are no projects", async () => {
    render(await HomeProjectsPanel({ feed: Promise.resolve(null) }));
    expect(screen.getByTestId("home-projects-empty")).toHaveTextContent(
      "error",
    );
  });
});

describe("HomeTeamDayPanel", () => {
  const task = {
    id: "task-1",
    name: "Research EU marketplaces",
    status: "COMPLETED" as const,
    updatedAt: HOURS_AGO,
    who: "Hannah",
  };

  it("heads the day with its counts and links each Task", async () => {
    render(
      await HomeTeamDayPanel({
        feed: Promise.resolve([task]),
        summary: Promise.resolve(summary),
      }),
    );

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      'recent · completed:{"count":3} · worked:{"minutes":45}',
    );
    const row = screen.getByRole("link", { name: /Research EU marketplaces/ });
    expect(row).toHaveAttribute("href", "/tasks/task-1");
    expect(row).toHaveTextContent("Hannah");
  });

  it("counts long work in hours", async () => {
    render(
      await HomeTeamDayPanel({
        feed: Promise.resolve([]),
        summary: Promise.resolve({ ...summary, workedMinutes: 7200 }),
      }),
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain(
      'workedHours:{"hours":120}',
    );
  });

  it("says so when nothing moved, and when the feed failed", async () => {
    render(
      await HomeTeamDayPanel({
        feed: Promise.resolve([]),
        summary: Promise.resolve(null),
      }),
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "recent",
    );
    expect(screen.getByTestId("home-team-day-empty")).toHaveTextContent(
      "empty",
    );

    cleanup();
    render(
      await HomeTeamDayPanel({
        feed: Promise.resolve(null),
        summary: Promise.resolve(null),
      }),
    );
    expect(screen.getByTestId("home-team-day-empty")).toHaveTextContent(
      "error",
    );
  });
});
