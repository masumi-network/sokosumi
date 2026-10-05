import { beforeEach, describe, expect, it, vi } from "vitest";

const { authRole, findUniqueMock, claimAvatarMock } = vi.hoisted(() => ({
  authRole: { value: "admin" as string | null },
  findUniqueMock: vi.fn(),
  claimAvatarMock: vi.fn(),
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

vi.mock("@/services/soko-bot-avatar.service", () => ({
  claimAvatar: claimAvatarMock,
}));

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mount from "./post";

const app = new OpenAPIHonoWithAuth();
mount(app);

const BOT_ID = "01a04a27-255e-7798-8fba-6f55fe79d132";
const AVATAR_ID = "01a04a27-255e-7798-8fba-6f55fe79d133";

function post() {
  return app.request(`http://localhost/${BOT_ID}/avatar`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ avatarId: AVATAR_ID }),
  });
}

describe("POST /admin/soko-bots/{sokoBotId}/avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRole.value = "admin";
  });

  it("gives the bot the chosen mascot", async () => {
    findUniqueMock.mockResolvedValue({ id: BOT_ID });
    claimAvatarMock.mockResolvedValue("https://blob/fox.png");

    const response = await post();

    expect(response.status).toBe(200);
    expect(claimAvatarMock).toHaveBeenCalledWith(BOT_ID, AVATAR_ID);
    await expect(response.json()).resolves.toMatchObject({
      data: { avatarImageUrl: "https://blob/fox.png" },
    });
  });

  it("refuses a non-admin", async () => {
    authRole.value = null;

    const response = await post();

    expect(response.status).toBe(403);
    expect(claimAvatarMock).not.toHaveBeenCalled();
  });

  it("404s an unknown bot", async () => {
    findUniqueMock.mockResolvedValue(null);

    const response = await post();

    expect(response.status).toBe(404);
    expect(claimAvatarMock).not.toHaveBeenCalled();
  });
});
