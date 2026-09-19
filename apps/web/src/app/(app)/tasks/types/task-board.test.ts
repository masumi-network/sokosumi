import { describe, expect, it } from "vitest";

import {
  COLUMN_STATUS_COLORS,
  KANBAN_COLUMNS,
} from "@/app/tasks/types/task-board";

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

describe("COLUMN_STATUS_COLORS", () => {
  /**
   * The bug this guards. `todo` and `in-progress` both read
   * `bg-status-working`, so the board drew three columns in two colours and
   * `READY` looked like `RUNNING`. Hue is the only thing saying which column a
   * task is in, so two columns may never share one.
   */
  it("gives every column a colour no other column uses", () => {
    const classes = KANBAN_COLUMNS.map(
      (column) => COLUMN_STATUS_COLORS[column.id],
    );

    expect(classes).not.toContain(undefined);
    expect(new Set(classes).size).toBe(classes.length);
  });
});
