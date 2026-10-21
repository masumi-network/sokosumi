import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionResultMock, getChatStateMock } = vi.hoisted(() => ({
  getSessionResultMock: vi.fn(),
  getChatStateMock: vi.fn(),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: getSessionResultMock,
}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: { getChatState: getChatStateMock },
}));

import { GET } from "./route";

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

function stateRequest(query = "") {
  return new Request(`https://web.test/api/personal-assistant/state${query}`);
}

describe("GET /api/personal-assistant/state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the browser has no session", async () => {
    getSessionResultMock.mockResolvedValue(ok(null));

    const response = await GET(stateRequest());

    expect(response.status).toBe(401);
    expect(getChatStateMock).not.toHaveBeenCalled();
  });

  /**
   * This is a poll that runs while a turn is in flight. Answering 401 for a
   * Core stall reads as a logout to a browser whose session is fine.
   */
  it("returns 503, not 401, when the session read could not reach Core", async () => {
    getSessionResultMock.mockResolvedValue(
      err({ path: "/auth/get-session", reason: "timeout" }),
    );

    const response = await GET(stateRequest());

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await response.json()).toEqual({
      error: "State unavailable",
      reason: "timeout",
    });
    expect(getChatStateMock).not.toHaveBeenCalled();
  });

  it("reads the caller's own bot without a bot id", async () => {
    getSessionResultMock.mockResolvedValue(ok({ user: { id: "u1" } }));
    getChatStateMock.mockResolvedValue(null);

    const response = await GET(stateRequest());

    expect(response.status).toBe(200);
    expect(getChatStateMock).toHaveBeenCalledWith(undefined);
  });

  it("reads the shared bot named by botId", async () => {
    getSessionResultMock.mockResolvedValue(ok({ user: { id: "u1" } }));
    getChatStateMock.mockResolvedValue(null);

    const response = await GET(stateRequest(`?botId=${BOT_ID}`));

    expect(response.status).toBe(200);
    expect(getChatStateMock).toHaveBeenCalledWith(BOT_ID);
  });

  it("returns 400 for a bot id that is not a uuid", async () => {
    const response = await GET(stateRequest("?botId=nope"));

    expect(response.status).toBe(400);
    expect(getChatStateMock).not.toHaveBeenCalled();
  });
});
