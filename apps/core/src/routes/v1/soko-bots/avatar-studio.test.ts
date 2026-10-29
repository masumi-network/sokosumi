import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createDraftMock,
  getStudioMock,
  keepDraftMock,
  memberFindFirstMock,
  resolveMock,
} = vi.hoisted(() => ({
  createDraftMock: vi.fn(),
  getStudioMock: vi.fn(),
  keepDraftMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  resolveMock: vi.fn(),
}));

const USER_ID = "user_1";
const WORKSPACE_ID = "01960001-0001-7001-8001-000000000010";
const BOT_ID = "01960001-0001-7001-8001-000000000099";
const DRAFT_ID = "01960001-0001-7001-8001-000000000044";

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

vi.mock("@/helpers/soko-bot-resolver", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/soko-bot-resolver")>();
  return { ...actual, memberSokoBot: resolveMock };
});

vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: vi.fn().mockResolvedValue({ disabled: false }),
  setSokoBotDisabled: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { member: { findFirst: memberFindFirstMock } },
}));

vi.mock("@/services/soko-bot-avatar-studio.service", () => ({
  createAvatarDraft: createDraftMock,
  getAvatarStudio: getStudioMock,
  keepAvatarDraft: keepDraftMock,
}));

import { tooManyRequests } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";

import app from "./index";

function createApp() {
  const parent = new Hono<{
    Variables: EnvVariables["Variables"] & RequestIdVariables;
  }>();
  parent.use("*", async (c, next) => {
    c.set("requestId", "req_avatar_studio");
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
      organizationId: "org_1",
    });
    await next();
  });
  parent.onError(errorHandler);
  parent.route("/", app);
  return parent;
}

const STUDIO = {
  avatar: null,
  look: null,
  draft: null,
  progress: { ready: 0, failed: 0, total: 0 },
  options: { creatures: [{ id: "owl" }], accessories: [{ id: "glasses" }] },
};

const DRAFT = {
  id: DRAFT_ID,
  imageUrl: "https://blob.test/draft.webp",
  look: { creature: "otter", accessories: [], typed: [] },
  expiresAt: "2026-10-30T12:00:00.000Z",
};

const CHANGE = { change: { kind: "creature", creature: "otter" } };

function send(method: "GET" | "POST", path: string, body?: unknown) {
  return createApp().request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("avatar studio routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStudioMock.mockResolvedValue(STUDIO);
    createDraftMock.mockResolvedValue({ draft: DRAFT, note: "" });
    keepDraftMock.mockResolvedValue(undefined);
  });

  describe("for your own bot", () => {
    beforeEach(() => {
      resolveMock.mockResolvedValue({
        id: BOT_ID,
        userId: USER_ID,
        workspaceId: WORKSPACE_ID,
      });
    });

    it("reads the look and the render progress", async () => {
      const response = await send("GET", "/me/avatar");

      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual(STUDIO);
      expect(getStudioMock).toHaveBeenCalledWith(BOT_ID);
    });

    it("drafts a change and returns the draft and the note", async () => {
      createDraftMock.mockResolvedValue({
        draft: DRAFT,
        note: "Made the hat a clay one.",
      });

      const response = await send("POST", "/me/avatar/drafts", {
        change: { kind: "typed", text: "give him a wizard hat" },
        draftId: DRAFT_ID,
      });

      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({
        draft: DRAFT,
        note: "Made the hat a clay one.",
      });
      expect(createDraftMock).toHaveBeenCalledWith({
        sokoBotId: BOT_ID,
        userId: USER_ID,
        change: { kind: "typed", text: "give him a wizard hat" },
        draftId: DRAFT_ID,
      });
    });

    it("answers a refusal with 200, the note and no draft", async () => {
      createDraftMock.mockResolvedValue({
        draft: null,
        note: "I can't draw that. How about a tiny sailor hat?",
      });

      const response = await send("POST", "/me/avatar/drafts", {
        change: { kind: "typed", text: "make him a famous cartoon mouse" },
      });

      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({
        draft: null,
        note: "I can't draw that. How about a tiny sailor hat?",
      });
    });

    it("defaults an accessory change to putting it on", async () => {
      await send("POST", "/me/avatar/drafts", {
        change: { kind: "accessory", accessory: "glasses" },
      });

      expect(createDraftMock.mock.calls[0]?.[0].change).toEqual({
        kind: "accessory",
        accessory: "glasses",
        enabled: true,
      });
    });

    it("says 429 with a plain message when the cap is spent", async () => {
      createDraftMock.mockRejectedValue(
        tooManyRequests("You can try at most 20 looks per hour.", {
          kind: "avatar_draft_rate_limited",
        }),
      );

      const response = await send("POST", "/me/avatar/drafts", CHANGE);

      expect(response.status).toBe(429);
      expect(JSON.stringify(await response.json())).toContain(
        "at most 20 looks per hour",
      );
    });

    it("keeps a draft for the caller's allowance and returns the studio", async () => {
      const response = await send("POST", `/me/avatar/drafts/${DRAFT_ID}/keep`);

      expect(response.status).toBe(200);
      expect(keepDraftMock).toHaveBeenCalledWith({
        sokoBotId: BOT_ID,
        userId: USER_ID,
        draftId: DRAFT_ID,
      });
      expect((await response.json()).data).toEqual(STUDIO);
    });

    it.each([
      ["an unknown kind", { change: { kind: "teleport" } }],
      ["empty typed text", { change: { kind: "typed", text: "  " } }],
      ["a missing change", {}],
    ])("rejects %s with 422 before any spend", async (_name, body) => {
      const response = await send("POST", "/me/avatar/drafts", body);

      expect(response.status).toBe(422);
      expect(createDraftMock).not.toHaveBeenCalled();
    });

    it("asks the owner to create a bot first when there is none", async () => {
      resolveMock.mockResolvedValue(null);

      const response = await send("POST", "/me/avatar/drafts", CHANGE);

      expect(response.status).toBe(404);
      expect(createDraftMock).not.toHaveBeenCalled();
    });
  });

  describe("for a shared bot", () => {
    beforeEach(() => {
      resolveMock.mockResolvedValue({
        id: BOT_ID,
        userId: null,
        workspaceId: WORKSPACE_ID,
      });
    });

    it.each(["owner", "admin"])(
      "lets an organization %s draft and keep",
      async (role) => {
        memberFindFirstMock.mockResolvedValue({ role });

        const draft = await send("POST", `/${BOT_ID}/avatar/drafts`, CHANGE);
        const keep = await send(
          "POST",
          `/${BOT_ID}/avatar/drafts/${DRAFT_ID}/keep`,
        );
        const read = await send("GET", `/${BOT_ID}/avatar`);

        expect([draft.status, keep.status, read.status]).toEqual([
          200, 200, 200,
        ]);
        expect(createDraftMock).toHaveBeenCalledWith(
          expect.objectContaining({ sokoBotId: BOT_ID, userId: USER_ID }),
        );
      },
    );

    it("keeps a plain member from changing it, and spends nothing", async () => {
      memberFindFirstMock.mockResolvedValue({ role: "member" });

      const responses = await Promise.all([
        send("POST", `/${BOT_ID}/avatar/drafts`, CHANGE),
        send("POST", `/${BOT_ID}/avatar/drafts/${DRAFT_ID}/keep`),
        send("GET", `/${BOT_ID}/avatar`),
      ]);

      expect(responses.map((response) => response.status)).toEqual([
        403, 403, 403,
      ]);
      expect(createDraftMock).not.toHaveBeenCalled();
      expect(keepDraftMock).not.toHaveBeenCalled();
    });

    it("answers 404 for a bot the caller cannot reach", async () => {
      resolveMock.mockResolvedValue(null);

      const response = await send("POST", `/${BOT_ID}/avatar/drafts`, CHANGE);

      expect(response.status).toBe(404);
      expect(createDraftMock).not.toHaveBeenCalled();
    });

    it("keeps someone else's personal bot closed even when reached by id", async () => {
      resolveMock.mockResolvedValue({
        id: BOT_ID,
        userId: "someone_else",
        workspaceId: WORKSPACE_ID,
      });

      const response = await send("POST", `/${BOT_ID}/avatar/drafts`, CHANGE);

      expect(response.status).toBe(403);
    });
  });
});
