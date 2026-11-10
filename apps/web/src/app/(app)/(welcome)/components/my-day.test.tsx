import type { TaskListItem } from "@sokosumi/core-client";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const listTasks = vi.fn();

function translate(key: string, values?: Record<string, unknown>): string {
  return values ? `${key}:${JSON.stringify(values)}` : key;
}

vi.mock("next-intl/server", () => ({
  getTranslations: async () => translate,
}));
vi.mock("@/lib/services/task.service", () => ({
  taskService: { listTasks: (...args: unknown[]) => listTasks(...args) },
}));
vi.mock("@/app/tasks/components/task-due-badge", () => ({
  TaskDueBadge: ({ dueOn }: { dueOn: string }) => <span>due {dueOn}</span>,
}));

import { loadMyDay, MY_DAY_LIMIT, MyDay } from "./my-day";

function task(
  id: string,
  dueOn: string,
  identifier: string | null = null,
): TaskListItem {
  // Only the fields My day reads.
  return {
    id,
    name: `Task ${id}`,
    status: "READY",
    dueOn,
    identifier,
  } as TaskListItem;
}

async function renderMyDay(feed: Awaited<ReturnType<typeof loadMyDay>>) {
  const { container } = render(await MyDay({ feed: Promise.resolve(feed) }));
  return container;
}

describe("My day", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("asks Core for the reader's open Tasks due by today, earliest first", async () => {
    listTasks.mockResolvedValue({
      tasks: [task("a", "2026-11-01")],
      pagination: { total: 7 },
    });

    await expect(loadMyDay("2026-11-10")).resolves.toEqual({
      tasks: [task("a", "2026-11-01")],
      total: 7,
    });
    const params = listTasks.mock.calls[0]?.[0];
    expect(params).toMatchObject({
      scope: "mine",
      dueOnTo: "2026-11-10",
      sort: "dueOn",
      limit: MY_DAY_LIMIT,
    });
    expect(params.status).toContain("DRAFT");
    expect(params.status).toContain("FAILED");
    expect(params.status).not.toContain("COMPLETED");
    expect(params.status).not.toContain("CANCELED");
  });

  it("gives null instead of failing Home when Core fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    listTasks.mockRejectedValue(new Error("down"));

    await expect(loadMyDay("2026-11-10")).resolves.toBeNull();
  });

  it("links each due Task and says how many more are due", async () => {
    await renderMyDay({
      tasks: [task("a", "2026-11-01", "SOK-4"), task("b", "2026-11-10")],
      total: 9,
    });

    expect(
      screen.getByRole("heading", { name: "title" }).textContent,
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Task a/ }).getAttribute("href"),
    ).toBe("/tasks/SOK-4-task-a");
    expect(
      screen.getByRole("link", { name: /Task b/ }).getAttribute("href"),
    ).toBe("/tasks/b");
    expect(screen.getByText("due 2026-11-01")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: 'more:{"count":7}' })
        .getAttribute("href"),
    ).toBe("/tasks");
  });

  it("leaves out the more link when every due Task fits", async () => {
    await renderMyDay({ tasks: [task("a", "2026-11-01")], total: 1 });

    expect(screen.queryByText(/^more:/)).toBeNull();
  });

  it("renders nothing when nothing is due or the feed failed", async () => {
    expect((await renderMyDay({ tasks: [], total: 0 })).innerHTML).toBe("");
    cleanup();
    expect((await renderMyDay(null)).innerHTML).toBe("");
  });
});
