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

  it("shows each teammate's bot with its one picture, or none for the orb", async () => {
    organizationFindMock.mockResolvedValue({
      name: "Acme",
      logo: null,
      members: [
        member("a", [
          bot("01960001-0001-7001-8001-0000000000a1", {
            avatarImageUrl: "https://blob.test/a-mascot.webp",
            status: "RUNNING",
          }),
        ]),
        member("b", [bot("01960001-0001-7001-8001-0000000000b1")]),
        member("c", []),
      ],
    });

    const response = await createApp("org_1").request("http://localhost/team");

    expect(response.status).toBe(200);
    const { members } = (await response.json()).data;
    expect(members[0].bot).toMatchObject({
      avatarImageUrl: "https://blob.test/a-mascot.webp",
      status: "RUNNING",
    });
    expect(members[1].bot.avatarImageUrl).toBeNull();
    expect(members[2].bot).toBeNull();
    for (const one of members.slice(0, 2)) {
      expect(one.bot).not.toHaveProperty("avatarState");
      expect(one.bot).not.toHaveProperty("avatar");
    }
  });

  it("does the same in a personal workspace", async () => {
    userFindMock.mockResolvedValue({
      id: USER_ID,
      name: "Me",
      image: null,
      sokoBots: [
        bot("01960001-0001-7001-8001-0000000000a1", {
          avatarImageUrl: "https://blob.test/me.webp",
        }),
      ],
    });

    const response = await createApp(null).request("http://localhost/team");

    expect(response.status).toBe(200);
    expect((await response.json()).data.members[0].bot.avatarImageUrl).toBe(
      "https://blob.test/me.webp",
    );
  });
});
