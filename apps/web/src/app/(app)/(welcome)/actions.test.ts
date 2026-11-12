import { afterEach, describe, expect, it, vi } from "vitest";

const { moveOverdueTasks: coreMove, undoMoveOverdueTasks: coreUndo } =
  vi.hoisted(() => ({
    moveOverdueTasks: vi.fn(),
    undoMoveOverdueTasks: vi.fn(),
  }));

vi.mock("@/lib/services/task.service", () => ({
  taskService: { moveOverdueTasks: coreMove, undoMoveOverdueTasks: coreUndo },
}));
vi.mock("./components/my-day", () => ({ loadMyDay: vi.fn() }));

import { moveOverdueTasks, undoMoveOverdueTasks } from "./actions";

const moved = [
  { id: "a", from: "2026-11-01", version: "2026-11-12T09:30:00.123Z" },
];

describe("moveOverdueTasks", () => {
  afterEach(() => vi.clearAllMocks());

  it("asks Core to move the reader's overdue Tasks and passes back what moved", async () => {
    coreMove.mockResolvedValue({ moved, skipped: 1 });

    await expect(
      moveOverdueTasks({ today: "2026-11-10", to: "2026-11-11" }),
    ).resolves.toEqual({ moved, skipped: 1 });
    expect(coreMove).toHaveBeenCalledWith({
      today: "2026-11-10",
      to: "2026-11-11",
    });
  });

  it("gives null for a bad day or a Core failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      moveOverdueTasks({ today: "today", to: "2026-11-11" }),
    ).resolves.toBeNull();
    expect(coreMove).not.toHaveBeenCalled();

    coreMove.mockRejectedValue(new Error("down"));
    await expect(
      moveOverdueTasks({ today: "2026-11-10", to: "2026-11-11" }),
    ).resolves.toBeNull();
  });
});

describe("undoMoveOverdueTasks", () => {
  afterEach(() => vi.clearAllMocks());

  it("sends each Task's old day and version back to Core", async () => {
    coreUndo.mockResolvedValue({ restored: ["a"], skipped: 0 });

    await expect(
      undoMoveOverdueTasks({ to: "2026-11-11", moved }),
    ).resolves.toEqual({ restored: 1, skipped: 0 });
    expect(coreUndo).toHaveBeenCalledWith({ to: "2026-11-11", tasks: moved });
  });

  it("gives null for an empty undo", async () => {
    await expect(
      undoMoveOverdueTasks({ to: "2026-11-11", moved: [] }),
    ).resolves.toBeNull();
    expect(coreUndo).not.toHaveBeenCalled();
  });
});
