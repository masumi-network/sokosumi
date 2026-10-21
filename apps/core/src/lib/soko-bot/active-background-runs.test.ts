import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueMock, findManyMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  findManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { findUnique: findUniqueMock, findMany: findManyMock },
  },
}));

import { withActiveBackgroundRuns } from "./active-background-runs";

describe("withActiveBackgroundRuns", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tells a chat turn which runs are still working", async () => {
    findUniqueMock.mockResolvedValue({
      sokoBotId: "bot-1",
      parentTurnId: null,
    });
    findManyMock.mockResolvedValue([
      {
        id: "run-1",
        backgroundTitle: "Compile the YC 2026 list",
        createdAt: new Date("2026-10-15T07:26:00Z"),
      },
    ]);
    const text = await withActiveBackgroundRuns("turn-1", "Stopped");
    expect(text).toContain("Stopped\n\n[Your background runs still working.");
    expect(text).toContain("stop_background_run");
    expect(text).toContain(
      '- "Compile the YC 2026 list" (runId run-1, started 2026-10-15T07:26:00.000Z)',
    );
  });

  it("leaves the message alone without running runs or inside a run", async () => {
    findUniqueMock.mockResolvedValue({
      sokoBotId: "bot-1",
      parentTurnId: null,
    });
    findManyMock.mockResolvedValue([]);
    expect(await withActiveBackgroundRuns("turn-1", "hi")).toBe("hi");

    findUniqueMock.mockResolvedValue({
      sokoBotId: "bot-1",
      parentTurnId: "turn-0",
    });
    expect(await withActiveBackgroundRuns("run-1", "brief")).toBe("brief");
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });
});
