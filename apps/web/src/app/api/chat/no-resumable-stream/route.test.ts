import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionResultMock } = vi.hoisted(() => ({
  getSessionResultMock: vi.fn(),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: getSessionResultMock,
}));

import { GET } from "./route";

function request() {
  return GET(
    new Request("https://web.test/api/chat/no-resumable-stream") as never,
  );
}

describe("GET /api/chat/no-resumable-stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("answers 204 so the AI SDK does not throw", async () => {
    getSessionResultMock.mockResolvedValue(
      ok({ user: { id: "user-1" }, session: {} }),
    );

    expect((await request()).status).toBe(204);
  });

  it("returns 401 when the browser has no session", async () => {
    getSessionResultMock.mockResolvedValue(ok(null));

    expect((await request()).status).toBe(401);
  });

  it("returns 503, not 401, when the session read could not reach Core", async () => {
    getSessionResultMock.mockResolvedValue(
      err({ path: "/auth/get-session", reason: "network" }),
    );

    const response = await request();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
  });
});
