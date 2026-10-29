import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  botFindFirstMock,
  createDraftMock,
  discardMock,
  getStudioMock,
  keepDraftMock,
  roleMock,
} = vi.hoisted(() => ({
  botFindFirstMock: vi.fn(),
  createDraftMock: vi.fn(),
  discardMock: vi.fn(),
  getStudioMock: vi.fn(),
  keepDraftMock: vi.fn(),
  roleMock: { value: "admin" },
}));

const BOT_ID = "01960001-0001-7001-8001-000000000099";
const DRAFT_ID = "01960001-0001-7001-8001-000000000044";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "user",
        userId: "user_staff",
        organizationId: null,
        role: roleMock.value,
      });
      await next();
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBot: { findFirst: botFindFirstMock } },
}));

vi.mock("@/services/soko-bot-avatar-studio.service", () => ({
  createAvatarDraft: createDraftMock,
  discardAvatarDrafts: discardMock,
  getAvatarStudio: getStudioMock,
  keepAvatarDraft: keepDraftMock,
}));

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import nestedApp from "../../index";

const app = new OpenAPIHonoWithAuth();
app.onError(errorHandler);
app.route("/", nestedApp);

const STUDIO = {
  avatar: null,
  look: null,
  draft: null,
  progress: { ready: 0, failed: 0, total: 0 },
  options: { creatures: [], accessories: [] },
};

function send(method: "GET" | "POST" | "DELETE", path: string, body?: unknown) {
  return app.request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("admin avatar studio routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roleMock.value = "admin";
    botFindFirstMock.mockResolvedValue({ id: BOT_ID });
    getStudioMock.mockResolvedValue(STUDIO);
    createDraftMock.mockResolvedValue({ draft: null, note: "" });
    keepDraftMock.mockResolvedValue(undefined);
    discardMock.mockResolvedValue(undefined);
  });

  it("cancels one draft or all of a bot's drafts", async () => {
    const one = await send("DELETE", `/${BOT_ID}/avatar/drafts/${DRAFT_ID}`);
    const all = await send("DELETE", `/${BOT_ID}/avatar/drafts`);

    expect([one.status, all.status]).toEqual([200, 200]);
    expect(discardMock).toHaveBeenNthCalledWith(1, {
      sokoBotId: BOT_ID,
      draftId: DRAFT_ID,
    });
    expect(discardMock).toHaveBeenNthCalledWith(2, { sokoBotId: BOT_ID });
    expect((await all.json()).data).toEqual(STUDIO);
  });

  it("lets staff draft for any bot, spending their own hourly allowance", async () => {
    const response = await send("POST", `/${BOT_ID}/avatar/drafts`, {
      change: { kind: "shuffle" },
    });

    expect(response.status).toBe(200);
    expect(createDraftMock).toHaveBeenCalledWith({
      sokoBotId: BOT_ID,
      userId: "user_staff",
      change: { kind: "shuffle" },
      draftId: undefined,
    });
  });

  it("keeps without a daily allowance", async () => {
    const response = await send(
      "POST",
      `/${BOT_ID}/avatar/drafts/${DRAFT_ID}/keep`,
    );

    expect(response.status).toBe(200);
    expect(keepDraftMock).toHaveBeenCalledWith({
      sokoBotId: BOT_ID,
      draftId: DRAFT_ID,
      userId: null,
    });
  });

  it("reads the studio of a bot", async () => {
    const response = await send("GET", `/${BOT_ID}/avatar`);

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(STUDIO);
  });

  it("refuses anyone who is not staff", async () => {
    roleMock.value = "user";

    const responses = await Promise.all([
      send("GET", `/${BOT_ID}/avatar`),
      send("POST", `/${BOT_ID}/avatar/drafts`, {
        change: { kind: "shuffle" },
      }),
      send("POST", `/${BOT_ID}/avatar/drafts/${DRAFT_ID}/keep`),
      send("DELETE", `/${BOT_ID}/avatar/drafts/${DRAFT_ID}`),
      send("DELETE", `/${BOT_ID}/avatar/drafts`),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      403, 403, 403, 403, 403,
    ]);
    expect(createDraftMock).not.toHaveBeenCalled();
    expect(discardMock).not.toHaveBeenCalled();
  });

  it("answers 404 for a bot that is gone", async () => {
    botFindFirstMock.mockResolvedValue(null);

    const response = await send("GET", `/${BOT_ID}/avatar`);

    expect(response.status).toBe(404);
  });
});
