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

describe("GET /api/personal-assistant/state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the browser has no session", async () => {
    getSessionResultMock.mockResolvedValue(ok(null));

    const response = await GET();

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

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await response.json()).toEqual({
      error: "State unavailable",
      reason: "timeout",
    });
    expect(getChatStateMock).not.toHaveBeenCalled();
  });
});
