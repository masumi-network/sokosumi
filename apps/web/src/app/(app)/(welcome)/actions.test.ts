import { afterEach, describe, expect, it, vi } from "vitest";

const { listOverdue, moveTaskDueDates } = vi.hoisted(() => ({
  listOverdue: vi.fn(),
  moveTaskDueDates: vi.fn(),
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: { moveTaskDueDates },
}));
vi.mock("./components/my-day", () => ({
  listOverdue,
  loadMyDay: vi.fn(),
  MOVE_OVERDUE_LIMIT: 100,
}));

import { moveOverdueTasks, undoMoveOverdueTasks } from "./actions";

describe("moveOverdueTasks", () => {
  afterEach(() => vi.clearAllMocks());

  it("moves each overdue Task from the day it has now, and reports what moved", async () => {
    listOverdue.mockResolvedValue({
      tasks: [
        { id: "a", dueOn: "2026-11-01" },
        { id: "b", dueOn: "2026-11-05" },
      ],
    });
    // Core skipped b: it changed since it was read.
    moveTaskDueDates.mockResolvedValue(["a"]);

    await expect(
      moveOverdueTasks({ today: "2026-11-10", to: "2026-11-11" }),
    ).resolves.toEqual({ moved: [{ id: "a", from: "2026-11-01" }], tried: 2 });
    expect(listOverdue).toHaveBeenCalledWith("2026-11-10");
    expect(moveTaskDueDates).toHaveBeenCalledWith([
      { id: "a", from: "2026-11-01", to: "2026-11-11" },
      { id: "b", from: "2026-11-05", to: "2026-11-11" },
    ]);
  });

  it("asks Core nothing when nothing is overdue", async () => {
    listOverdue.mockResolvedValue({ tasks: [] });

    await expect(
      moveOverdueTasks({ today: "2026-11-10", to: "2026-11-11" }),
    ).resolves.toEqual({ moved: [], tried: 0 });
    expect(moveTaskDueDates).not.toHaveBeenCalled();
  });

  it("gives null for a bad day or a Core failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      moveOverdueTasks({ today: "today", to: "2026-11-11" }),
    ).resolves.toBeNull();
    expect(listOverdue).not.toHaveBeenCalled();

    listOverdue.mockRejectedValue(new Error("down"));
    await expect(
      moveOverdueTasks({ today: "2026-11-10", to: "2026-11-11" }),
    ).resolves.toBeNull();
  });
});

describe("undoMoveOverdueTasks", () => {
  afterEach(() => vi.clearAllMocks());

  it("puts each Task back only from the day the move gave it", async () => {
    moveTaskDueDates.mockResolvedValue(["a"]);

    await expect(
      undoMoveOverdueTasks({
        to: "2026-11-11",
        moved: [
          { id: "a", from: "2026-11-01" },
          { id: "b", from: "2026-11-05" },
        ],
      }),
    ).resolves.toBe(1);
    expect(moveTaskDueDates).toHaveBeenCalledWith([
      { id: "a", from: "2026-11-11", to: "2026-11-01" },
      { id: "b", from: "2026-11-11", to: "2026-11-05" },
    ]);
  });

  it("gives null for an empty undo", async () => {
    await expect(
      undoMoveOverdueTasks({ to: "2026-11-11", moved: [] }),
    ).resolves.toBeNull();
    expect(moveTaskDueDates).not.toHaveBeenCalled();
  });
});
