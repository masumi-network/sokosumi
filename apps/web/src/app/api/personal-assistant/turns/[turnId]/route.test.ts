import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionResultMock, getTurnMock } = vi.hoisted(() => ({
  getSessionResultMock: vi.fn(),
  getTurnMock: vi.fn(),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: getSessionResultMock,
}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: { getTurn: getTurnMock },
}));
vi.mock("@/lib/soko-bot/chat-state", () => ({
  toChatTurnDetail: (turn: unknown) => turn,
}));

import { GET } from "./route";

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

function request(query = "") {
  return GET(
    new Request(`https://web.test/api/personal-assistant/turns/t1${query}`),
    { params: Promise.resolve({ turnId: "t1" }) },
  );
}

describe("GET /api/personal-assistant/turns/[turnId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the browser has no session", async () => {
    getSessionResultMock.mockResolvedValue(ok(null));

    const response = await request();

    expect(response.status).toBe(401);
    expect(getTurnMock).not.toHaveBeenCalled();
  });

  it("returns 503, not 401, when the session read could not reach Core", async () => {
    getSessionResultMock.mockResolvedValue(
      err({ path: "/auth/get-session", reason: "invalid_json" }),
    );

    const response = await request();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Turn unavailable",
      reason: "invalid_json",
    });
    expect(getTurnMock).not.toHaveBeenCalled();
  });

  it("reads the turn of the shared bot named by botId", async () => {
    getSessionResultMock.mockResolvedValue(ok({ user: { id: "u1" } }));
    getTurnMock.mockResolvedValue({ id: "t1" });

    const response = await request(`?botId=${BOT_ID}`);

    expect(response.status).toBe(200);
    expect(getTurnMock).toHaveBeenCalledWith("t1", BOT_ID);
  });

  it("returns 400 for a bot id that is not a uuid", async () => {
    const response = await request("?botId=nope");

    expect(response.status).toBe(400);
    expect(getTurnMock).not.toHaveBeenCalled();
  });
});
