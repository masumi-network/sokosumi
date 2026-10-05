import { beforeEach, describe, expect, it, vi } from "vitest";

const pending: Promise<unknown>[] = [];
const {
  createEventMock,
  createSandboxMock,
  driveGetOrCreateMock,
  getSandboxMock,
  reconcileTurnMock,
} = vi.hoisted(() => ({
  createEventMock: vi.fn(),
  createSandboxMock: vi.fn(),
  driveGetOrCreateMock: vi.fn(),
  getSandboxMock: vi.fn(),
  reconcileTurnMock: vi.fn(),
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => pending.push(promise),
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
  sokoBotControlPlane: { reconcileTurn: reconcileTurnMock },
}));

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
    driveGetOrCreateMock.mockRejectedValue(new Error("Drive unavailable"));
    await new SandboxSokoBotRuntime().createSession(turn);
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
    expect(reconcileTurnMock).toHaveBeenCalledWith("turn_2");
  });
});
