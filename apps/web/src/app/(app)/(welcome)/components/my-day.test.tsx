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
vi.mock("./move-overdue-menu.client", () => ({
  MoveOverdueMenu: ({ today, count }: { today: string; count: number }) => (
    <pre data-testid="move">{JSON.stringify({ today, count })}</pre>
  ),
}));
vi.mock("./my-day-list.client", () => ({
  MyDayList: ({ today, initial }: { today: string; initial: unknown }) => (
    <pre data-testid="list">{JSON.stringify({ today, initial })}</pre>
  ),
}));

import {
  countOverdue,
  loadMyDay,
  MOVE_OVERDUE_LIMIT,
  MY_DAY_LIMIT,
  MyDay,
  type MyDayPage,
} from "./my-day";

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

describe("loadMyDay", () => {
  afterEach(() => vi.clearAllMocks());

  it("asks Core for the reader's open Tasks due by today, earliest first", async () => {
    listTasks.mockResolvedValue({
      tasks: [task("a", "2026-11-01", "SOK-4")],
      pagination: { total: 7, nextCursor: "a" },
    });

    await expect(loadMyDay("2026-11-10")).resolves.toEqual({
      rows: [
        {
          id: "a",
          name: "Task a",
          status: "READY",
          dueOn: "2026-11-01",
          href: "/tasks/SOK-4-task-a",
        },
      ],
      total: 7,
      nextCursor: "a",
    });
    const params = listTasks.mock.calls[0]?.[0];
    expect(params).toMatchObject({
      scope: "mine",
      dueOnTo: "2026-11-10",
      sort: "dueOn",
      limit: MY_DAY_LIMIT,
      cursor: null,
    });
    expect(params.status).toContain("DRAFT");
    expect(params.status).toContain("FAILED");
    expect(params.status).not.toContain("COMPLETED");
    expect(params.status).not.toContain("CANCELED");
  });

  it("continues the same query from a cursor", async () => {
    listTasks.mockResolvedValue({
      tasks: [task("f", "2026-11-10")],
      pagination: { total: 6, nextCursor: null },
    });

    const page = await loadMyDay("2026-11-10", "e");

    expect(listTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "mine",
        dueOnTo: "2026-11-10",
        sort: "dueOn",
        cursor: "e",
      }),
    );
    expect(page?.rows.map((row) => row.href)).toEqual(["/tasks/f"]);
    expect(page?.nextCursor).toBeNull();
  });

  it("gives null instead of failing Home when Core fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    listTasks.mockRejectedValue(new Error("down"));

    await expect(loadMyDay("2026-11-10")).resolves.toBeNull();
  });
});

describe("countOverdue", () => {
  afterEach(() => vi.clearAllMocks());

  it("counts open Tasks due before today, capped at one move", async () => {
    listTasks.mockResolvedValue({
      tasks: [task("a", "2026-11-01")],
      pagination: { total: 250, nextCursor: "a" },
    });

    await expect(countOverdue("2026-11-10")).resolves.toBe(MOVE_OVERDUE_LIMIT);
    const query = listTasks.mock.calls[0]?.[0];
    expect(query).toMatchObject({
      scope: "mine",
      dueOnTo: "2026-11-09",
      sort: "dueOn",
      limit: 1,
    });
    expect(query.status).not.toContain("COMPLETED");
    expect(query.status).not.toContain("CANCELED");
    expect(query.status).not.toContain("GRANT_PENDING");
  });

  it("hides the move when Core fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    listTasks.mockRejectedValue(new Error("down"));
    await expect(countOverdue("2026-11-10")).resolves.toBe(0);
  });
});

describe("MyDay", () => {
  afterEach(() => cleanup());

  async function renderMyDay(
    feed: MyDayPage | null,
    overdue = 0,
  ): Promise<HTMLElement> {
    const { container } = render(
      await MyDay({
        feed: Promise.resolve(feed),
        overdue: Promise.resolve(overdue),
        today: "2026-11-10",
      }),
    );
    return container;
  }

  it("hands the first page and its day to the list under a heading", async () => {
    const page: MyDayPage = {
      rows: [
        {
          id: "a",
          name: "Task a",
          status: "READY",
          dueOn: "2026-11-01",
          href: "/tasks/a",
        },
      ],
      total: 1,
      nextCursor: null,
    };
    await renderMyDay(page);

    expect(screen.getByRole("heading", { name: "title" })).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("list").textContent ?? "")).toEqual({
      today: "2026-11-10",
      initial: page,
    });
  });

  it("offers Move overdue only when something is overdue", async () => {
    const page: MyDayPage = {
      rows: [
        {
          id: "a",
          name: "Task a",
          status: "READY",
          dueOn: "2026-11-10",
          href: "/tasks/a",
        },
      ],
      total: 1,
      nextCursor: null,
    };
    await renderMyDay(page);
    expect(screen.queryByTestId("move")).toBeNull();
    cleanup();

    await renderMyDay(page, 3);
    expect(JSON.parse(screen.getByTestId("move").textContent ?? "")).toEqual({
      today: "2026-11-10",
      count: 3,
    });
  });

  it("renders nothing when nothing is due or the feed failed", async () => {
    expect(
      (await renderMyDay({ rows: [], total: 0, nextCursor: null })).innerHTML,
    ).toBe("");
    cleanup();
    expect((await renderMyDay(null)).innerHTML).toBe("");
  });
});
