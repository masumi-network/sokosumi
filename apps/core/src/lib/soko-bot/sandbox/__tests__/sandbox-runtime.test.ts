import { beforeEach, describe, expect, it, vi } from "vitest";

const pending: Promise<unknown>[] = [];
const { createEventMock, getOrCreateMock, reconcileTurnMock } = vi.hoisted(
  () => ({
    createEventMock: vi.fn(),
    getOrCreateMock: vi.fn(),
    reconcileTurnMock: vi.fn(),
  }),
);

vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => pending.push(promise),
}));
vi.mock("@vercel/sandbox", () => ({
  Sandbox: { getOrCreate: getOrCreateMock, get: vi.fn() },
}));
vi.mock("@/config/env", () => ({
  getEnv: () => ({
    BETTER_AUTH_SECRET: "secret",
    SOKO_BOT_SANDBOX_REGION: "fra1",
    SOKO_BOT_SANDBOX_VCPUS: 2,
    SOKO_BOT_RUNTIME_PUBLIC_URL: "https://core.example.com",
  }),
  getBetterAuthPublicBaseUrl: () => "https://core.example.com",
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ deadlineAt: new Date(Date.now() + 900_000) }),
    },
    sokoBotRuntimeEvent: {
      create: createEventMock,
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  sokoBotControlPlane: { reconcileTurn: reconcileTurnMock },
}));

import { SandboxSokoBotRuntime } from "../sandbox-runtime";

describe("SandboxSokoBotRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pending.length = 0;
    createEventMock.mockResolvedValue({});
  });

  it("settles a turn whose sandbox never started, so it does not sit RUNNING", async () => {
    getOrCreateMock.mockRejectedValue(new Error("Invalid CIDR"));
    const ref = await new SandboxSokoBotRuntime().createSession({
      sessionId: null,
      turnId: "turn_1",
      message: "Plan the launch",
      userId: "user_1",
      sokoBotId: "bot_1",
      workspaceId: "workspace_1",
    });
    await Promise.all(pending);

    expect(ref.runtimeVersion).toBe("sandbox-1");
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
    expect(reconcileTurnMock).toHaveBeenCalledWith("turn_1");
  });
});
