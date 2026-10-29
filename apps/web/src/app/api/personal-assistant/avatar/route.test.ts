import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionResultMock, getAvatarStudioMock } = vi.hoisted(() => ({
  getSessionResultMock: vi.fn(),
  getAvatarStudioMock: vi.fn(),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: getSessionResultMock,
}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: { getAvatarStudio: getAvatarStudioMock },
}));

import { GET } from "./route";

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

function avatarRequest(query = "") {
  return new Request(`https://web.test/api/personal-assistant/avatar${query}`);
}

describe("GET /api/personal-assistant/avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the browser has no session", async () => {
    getSessionResultMock.mockResolvedValue(ok(null));

    const response = await GET(avatarRequest());

    expect(response.status).toBe(401);
    expect(getAvatarStudioMock).not.toHaveBeenCalled();
  });

  it("returns 503, not 401, when the session read could not reach Core", async () => {
    getSessionResultMock.mockResolvedValue(
      err({ path: "/auth/get-session", reason: "timeout" }),
    );

    const response = await GET(avatarRequest());

    expect(response.status).toBe(503);
    expect(getAvatarStudioMock).not.toHaveBeenCalled();
  });

  it("reads the caller's own bot without a bot id", async () => {
    getSessionResultMock.mockResolvedValue(ok({ user: { id: "u1" } }));
    getAvatarStudioMock.mockResolvedValue({ progress: { ready: 6 } });

    const response = await GET(avatarRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      studio: { progress: { ready: 6 } },
    });
    expect(getAvatarStudioMock).toHaveBeenCalledWith(undefined);
  });

  it("reads the shared bot named by botId", async () => {
    getSessionResultMock.mockResolvedValue(ok({ user: { id: "u1" } }));
    getAvatarStudioMock.mockResolvedValue({});

    await GET(avatarRequest(`?botId=${BOT_ID}`));

    expect(getAvatarStudioMock).toHaveBeenCalledWith(BOT_ID);
  });

  it("returns 400 for a bot id that is not a uuid", async () => {
    const response = await GET(avatarRequest("?botId=nope"));

    expect(response.status).toBe(400);
  });
});
