import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { organizationFindMock, userFindMock } = vi.hoisted(() => ({
  organizationFindMock: vi.fn(),
  userFindMock: vi.fn(),
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), SOKO_BOT_ENABLED: true }),
  };
});

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

vi.mock("@/middleware/coworker-context", () => ({
  coworkerContextMiddleware: async (_c: unknown, next: () => Promise<void>) =>
    await next(),
}));

vi.mock("@/middleware/organization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/middleware/organization")>();
  return {
    ...actual,
    organizationContextMiddleware: async (
      _c: unknown,
      next: () => Promise<void>,
    ) => await next(),
  };
});

vi.mock("@/middleware/workspace", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/middleware/workspace")>();
  return {
    ...actual,
    workspaceMiddleware: () => async (_c: unknown, next: () => Promise<void>) =>
      await next(),
  };
});

vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: vi.fn().mockResolvedValue({ disabled: false }),
  setSokoBotDisabled: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: { findUnique: organizationFindMock },
    user: { findUnique: userFindMock },
  },
}));

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";

import app from "../index";

const USER_ID = "user_1";
const WORKSPACE_ID = "01960001-0001-7001-8001-000000000010";

function createApp(organizationId: string | null) {
  const parent = new Hono<{
    Variables: EnvVariables["Variables"] & RequestIdVariables;
  }>();
  parent.use("*", async (c, next) => {
    c.set("requestId", "req_team");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: USER_ID,
      organizationId: null,
      role: "user",
      authenticationMethod: "session",
    });
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      organizationId,
    });
    await next();
  });
  parent.onError(errorHandler);
  parent.route("/", app);
  return parent;
}

function bot(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    avatarImageUrl: null,
    avatarSeed: null,
    status: "IDLE",
    lastActivityAt: null,
    archivedAt: null,
    adminPausedAt: null,
    avatar: null,
    turns: [],
    pendingDecisions: [],
    ...overrides,
  };
}

function member(userId: string, sokoBots: unknown[]) {
  return {
    role: "member",
    user: { id: userId, name: userId, image: null, sokoBots },
  };
}

describe("GET /team", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gives each teammate's bot its own avatar state and avatar", async () => {
    organizationFindMock.mockResolvedValue({
      name: "Acme",
      logo: null,
      members: [
        member("a", [
          bot("01960001-0001-7001-8001-0000000000a1", {
            avatarImageUrl: "https://blob.test/a-idle.webp",
            // A decision during a run: it is waiting on its owner.
            turns: [{ status: "RUNNING", completedAt: null }],
            pendingDecisions: [{ id: "d1" }],
            avatar: {
              styleId: "crafted-desk",
              styleVersion: 1,
              imageUrl: "https://blob.test/a-idle.webp",
              renders: [
                {
                  state: "IDLE",
                  stillUrl: "https://blob.test/a-idle.webp",
                  loopUrl: null,
                  loopLargeUrl: null,
                },
              ],
            },
          }),
        ]),
        member("b", [
          bot("01960001-0001-7001-8001-0000000000b1", {
            avatarImageUrl: "https://blob.test/b-mascot.png",
            turns: [
              {
                status: "COMPLETED",
                completedAt: new Date(Date.now() - 60_000),
              },
            ],
          }),
        ]),
        member("c", [
          bot("01960001-0001-7001-8001-0000000000c1", { status: "PAUSED" }),
        ]),
        member("d", []),
      ],
    });

    const response = await createApp("org_1").request("http://localhost/team");

    expect(response.status).toBe(200);
    const { members } = (await response.json()).data;
    expect(
      members.map((one: { bot: { avatarState: string } | null }) =>
        one.bot ? one.bot.avatarState : null,
      ),
    ).toEqual(["needs_you", "done", "offline", null]);
    // Partial renders: the idle still is there, the other states are null.
    expect(members[0].bot.avatar).toMatchObject({
      styleId: "crafted-desk",
      stillUrl: "https://blob.test/a-idle.webp",
      states: {
        idle: { stillUrl: "https://blob.test/a-idle.webp", loopUrl: null },
        thinking: null,
        offline: null,
      },
    });
    // The legacy fallback: one image, no states, and the old field intact.
    expect(members[1].bot).toMatchObject({
      avatarImageUrl: "https://blob.test/b-mascot.png",
      avatar: {
        styleId: "mascot",
        stillUrl: "https://blob.test/b-mascot.png",
        states: { idle: null, working: null },
      },
    });
    // A bot with no image at all keeps the generative orb.
    expect(members[2].bot.avatar).toBeNull();
  });

  it("does the same in a personal workspace", async () => {
    userFindMock.mockResolvedValue({
      id: USER_ID,
      name: "Me",
      image: null,
      sokoBots: [
        bot("01960001-0001-7001-8001-0000000000a1", {
          turns: [{ status: "QUEUED", completedAt: null }],
        }),
      ],
    });

    const response = await createApp(null).request("http://localhost/team");

    expect(response.status).toBe(200);
    expect((await response.json()).data.members[0].bot.avatarState).toBe(
      "thinking",
    );
  });

  it("asks the database for the latest foreground turn and any open decision", async () => {
    organizationFindMock.mockResolvedValue({
      name: "Acme",
      logo: null,
      members: [],
    });
    userFindMock.mockResolvedValue(null);

    await createApp("org_1").request("http://localhost/team");

    const select =
      organizationFindMock.mock.calls[0]?.[0].select.members.select.user.select
        .sokoBots.select;
    expect(select.turns).toMatchObject({
      where: { parentTurnId: null },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(select.pendingDecisions.where).toMatchObject({ status: "PENDING" });
    expect(select.adminPausedAt).toBe(true);
  });
});
