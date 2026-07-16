import { describe, expect, it } from "vitest";

import { KANBAN_COLUMNS } from "@/app/tasks/types/task-board";

describe("KANBAN_COLUMNS", () => {
  it("orders backlog before todo so backlog↔todo drag columns are adjacent", () => {
    const columnIds = KANBAN_COLUMNS.map((column) => column.id);
    const backlogIndex = columnIds.indexOf("backlog");
    const todoIndex = columnIds.indexOf("todo");

    expect(backlogIndex).toBeGreaterThan(-1);
    expect(todoIndex).toBeGreaterThan(-1);
    expect(backlogIndex).toBeLessThan(todoIndex);
    expect(todoIndex - backlogIndex).toBe(1);
  });
});
