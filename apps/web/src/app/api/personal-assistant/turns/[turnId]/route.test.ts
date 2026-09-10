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

function request() {
  return GET(new Request("https://web.test/api/personal-assistant/turns/t1"), {
    params: Promise.resolve({ turnId: "t1" }),
  });
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
});
