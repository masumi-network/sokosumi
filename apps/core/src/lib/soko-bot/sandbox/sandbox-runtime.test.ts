import { beforeEach, describe, expect, it, vi } from "vitest";

const pending: Promise<unknown>[] = [];
const {
  createEventMock,
  createSandboxMock,
  driveGetOrCreateMock,
  getSandboxMock,
  reconcileRuntimeCompletionMock,
} = vi.hoisted(() => ({
  createEventMock: vi.fn(),
  createSandboxMock: vi.fn(),
  driveGetOrCreateMock: vi.fn(),
  getSandboxMock: vi.fn(),
  reconcileRuntimeCompletionMock: vi.fn(),
}));

// PostgreSQL's clock is the test clock here.
vi.mock("@/lib/db/database-now", () => ({
  databaseNow: async () => new Date(),
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn((promise: Promise<unknown>) => pending.push(promise)),
}));
vi.mock("@vercel/sandbox", () => ({
  Sandbox: { create: createSandboxMock, get: getSandboxMock },
  Drive: { getOrCreate: driveGetOrCreateMock },
}));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from("runner")),
}));
vi.mock("@/config/env", () => ({
  getEnv: () => ({
    BETTER_AUTH_SECRET: "secret",
    SOKO_BOT_RUNTIME_PUBLIC_URL: "https://core.example.com",
  }),
  getBetterAuthPublicBaseUrl: () => "https://core.example.com",
}));
vi.mock("@/lib/db/prisma", () => {
  const client = {
    sokoBotTurn: {
      findFirst: vi.fn().mockResolvedValue({ id: "turn_2" }),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ deadlineAt: new Date(Date.now() + 900_000) }),
    },
    sokoBotRuntimeEvent: {
      create: createEventMock,
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
  return {
    default: {
      ...client,
      $transaction: (operation: (tx: unknown) => Promise<unknown>) =>
        operation({ ...client, $executeRaw: vi.fn() }),
    },
  };
});
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  sokoBotControlPlane: {
    reconcileRuntimeCompletion: reconcileRuntimeCompletionMock,
  },
}));

import { expectCoreLogWhys } from "@/test/core-log";
import { SandboxSokoBotRuntime } from "./sandbox-runtime";

const turn = {
  sessionId: null,
  turnId: "turn_2",
  message: "Plan the launch",
  userId: "user_1",
  sokoBotId: "bot_1",
  workspaceId: "workspace_1",
};

describe("SandboxSokoBotRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pending.length = 0;
    createEventMock.mockResolvedValue({});
    getSandboxMock.mockResolvedValue({ stop: vi.fn() });
  });

  it("closes a cancelled turn so it settles without its runner", async () => {
    await new SandboxSokoBotRuntime().cancelTurn({
      sessionId: "sess_1",
      eveTurnId: "turn_2",
    });
    const types = createEventMock.mock.calls.map(
      ([args]) => (args as { data: { type: string } }).data.type,
    );
    expect(types).toEqual(["turn.cancelled", "session.waiting"]);
  });

  it("runs each turn in a new VM, after stopping any VM still on the workspace", async () => {
    const staleStop = vi.fn();
    getSandboxMock.mockResolvedValueOnce({ stop: staleStop });
    driveGetOrCreateMock.mockResolvedValue({
      currentSandboxName: "soko-bot-turn-turn_1",
    });
    const runCommand = vi.fn();
    createSandboxMock.mockResolvedValue({
      writeFiles: vi.fn(),
      runCommand,
    });

    await new SandboxSokoBotRuntime().createSession(turn);
    await Promise.all(pending);

    expect(getSandboxMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "soko-bot-turn-turn_1" }),
    );
    expect(staleStop).toHaveBeenCalled();
    const created = createSandboxMock.mock.calls[0]?.[0];
    expect(created).toMatchObject({
      name: "soko-bot-turn-turn_2",
      region: "fra1",
      mounts: { "/vercel/sandbox/workspace": expect.anything() },
    });
    // The token rides the proxy for this turn's Core paths only.
    const coreRules = created.networkPolicy.allow["core.example.com"];
    expect(coreRules[0].match.path.startsWith).toBe(
      "/v1/soko-bot-runtime/turns/turn_2/",
    );
    expect(created.env).toBeUndefined();
    expect(runCommand.mock.calls[0]?.[0].env).toEqual({
      SOKO_BOT_CORE_URL: "https://core.example.com",
      SOKO_BOT_TURN_ID: "turn_2",
    });
  });

  it("settles a turn whose VM never started, so it does not sit RUNNING", async () => {
    const errors = expectCoreLogWhys(
      "error",
      "Could not start a Soko Bot turn's sandbox",
      ["Creating the Vercel Sandbox VM, its Drive or the runner failed"],
    );
    driveGetOrCreateMock.mockRejectedValue(new Error("Drive unavailable"));
    await new SandboxSokoBotRuntime().createSession({
      ...turn,
      reconciliationLeaseToken: "launch-lease",
    });
    await Promise.all(pending);

    // The drain binds on turn.started + message.received before it reads a
    // failure; without them the failure is skipped.
    expect(createEventMock.mock.calls.map((call) => call[0].data.type)).toEqual(
      [
        "session.started",
        "turn.started",
        "message.received",
        "turn.failed",
        "session.waiting",
      ],
    );
    expect(reconcileRuntimeCompletionMock).toHaveBeenCalledWith(
      "turn_2",
      expect.any(String),
      "launch-lease",
    );
    expect(errors[0]?.event).toMatchObject({
      operation: "soko_bot_sandbox_launch",
      turnId: "turn_2",
      failure: { errorName: "Error" },
    });
    expect(errors[0]?.cause).toBeUndefined();
  });
});
