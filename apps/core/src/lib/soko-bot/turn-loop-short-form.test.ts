import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorize, taintEvent, appended } = vi.hoisted(() => ({
  authorize: vi.fn(),
  taintEvent: vi.fn(),
  appended: [] as string[],
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBotRuntimeEvent: { findFirst: taintEvent } },
}));
vi.mock("@/services/soko-bot-runtime.service", () => ({
  sokoBotRuntimeService: { authorize, executeTool: vi.fn() },
}));

const { runTurnTool } = await import("./turn-loop");

const log = {
  turnId: "turn_1",
  sessionId: "session_1",
  append: async (event: { type: string }) => {
    appended.push(event.type);
  },
} as never;

function shortSave() {
  return runTurnTool({
    log,
    capability: "save_strategy",
    toolCallId: "call_1",
    toolInput: { shortForm: true, what: "move a post" },
  });
}

describe("a short-form save", () => {
  beforeEach(() => {
    authorize.mockReset();
    taintEvent.mockReset();
    appended.length = 0;
  });

  it("promises the full tool on a turn that may save", async () => {
    taintEvent.mockResolvedValue(null);
    authorize.mockResolvedValue({});
    await expect(shortSave()).resolves.toMatchObject({ saved: false });
    expect(authorize).toHaveBeenCalledWith({
      sessionId: "session_1",
      turnId: "turn_1",
      capability: "save_strategy",
    });
  });

  it("follows the same web-read rule as the full call", async () => {
    // Cuso researches the web and then saves: save_strategy stays allowed
    // after a web read, in its short form as in its full one.
    taintEvent.mockResolvedValue({ id: "tainted" });
    authorize.mockResolvedValue({});
    await expect(shortSave()).resolves.toMatchObject({ saved: false });
  });

  it("says the tool is not open when the turn's route does not grant it", async () => {
    taintEvent.mockResolvedValue(null);
    authorize.mockRejectedValue(
      new Error("Capability is not granted for this turn"),
    );
    await expect(shortSave()).rejects.toThrow(
      /save_strategy is not open on this turn/,
    );
    expect(appended).toEqual([]);
  });
});
