import { describe, expect, it } from "vitest";

import { KANBAN_COLUMNS } from "@/lib/types/task";

describe("KANBAN_COLUMNS", () => {
  it("orders scheduled after todo so backlog↔todo drag does not cross scheduled", () => {
    const columnIds = KANBAN_COLUMNS.map((column) => column.id);
    const scheduledIndex = columnIds.indexOf("scheduled");
    const todoIndex = columnIds.indexOf("todo");

    expect(scheduledIndex).toBeGreaterThan(-1);
    expect(todoIndex).toBeGreaterThan(-1);
    expect(todoIndex).toBeLessThan(scheduledIndex);
  });
});
