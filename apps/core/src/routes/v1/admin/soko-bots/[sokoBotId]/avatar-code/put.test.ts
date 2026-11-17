import { beforeEach, describe, expect, it, vi } from "vitest";

const { authRole, findUniqueMock, setCodeMock } = vi.hoisted(() => ({
  authRole: { value: "admin" as string | null },
  findUniqueMock: vi.fn(),
  setCodeMock: vi.fn(),
}));

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
        userId: "user_admin",
        organizationId: null,
        role: authRole.value,
      });
      await next();
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBot: { findUnique: findUniqueMock } },
}));
vi.mock("@/services/soko-bot-avatar-code.service", () => ({
  setSokoBotAvatarCode: setCodeMock,
}));

import { HTTPException } from "hono/http-exception";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mount from "./put";

const app = new OpenAPIHonoWithAuth();
mount(app);

const BOT_ID = "01a04a27-255e-7798-8fba-6f55fe79d132";
const CODE = "v1.owl.golden.peach.crimson.l.M.original.original.none.none";
const RESULT = { avatarCode: CODE, avatarImageUrl: "https://blob.test/c.webp" };

function put() {
  return app.request(`http://localhost/${BOT_ID}/avatar-code`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: CODE }),
  });
}

describe("PUT /admin/soko-bots/{sokoBotId}/avatar-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRole.value = "admin";
    findUniqueMock.mockResolvedValue({ id: BOT_ID });
    setCodeMock.mockResolvedValue(RESULT);
  });

  it("sets the bot's look", async () => {
    const response = await put();

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(RESULT);
    expect(setCodeMock).toHaveBeenCalledWith(BOT_ID, CODE);
  });

  it("refuses a non-admin", async () => {
    authRole.value = null;

    expect((await put()).status).toBe(403);
    expect(setCodeMock).not.toHaveBeenCalled();
  });

  it("answers 404 for a missing bot", async () => {
    findUniqueMock.mockResolvedValue(null);

    expect((await put()).status).toBe(404);
  });

  it("passes the service's 409 through", async () => {
    setCodeMock.mockRejectedValue(new HTTPException(409, { message: "taken" }));

    expect((await put()).status).toBe(409);
  });
});
