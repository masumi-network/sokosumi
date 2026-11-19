import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionResult, getLabTurn } = vi.hoisted(() => ({
  getSessionResult: vi.fn(),
  getLabTurn: vi.fn(),
}));

vi.mock("@/lib/auth/auth.server", () => ({ getSessionResult }));
vi.mock("@/lib/services/admin-soko-bot.service", () => ({
  adminSokoBotService: { getLabTurn },
}));
vi.mock("@/lib/soko-bot/chat-state", () => ({
  toChatTurnDetail: (turn: unknown) => turn,
}));

import { GET } from "./route";

function request() {
  return GET(new Request("https://web.test/api/admin/soko-bots/turns/t1"), {
    params: Promise.resolve({ turnId: "t1" }),
  });
}

describe("GET /api/admin/soko-bots/turns/[turnId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLabTurn.mockResolvedValue({ id: "t1" });
  });

  it.each([
    { session: null, status: 401 },
    { session: { user: { role: "user" } }, status: 403 },
  ])("returns $status before loading the turn", async ({ session, status }) => {
    getSessionResult.mockResolvedValue(ok(session));

    const response = await request();

    expect.soft(response.status).toBe(status);
    expect(getLabTurn).not.toHaveBeenCalled();
  });

  it("returns 503 when the session read is unavailable", async () => {
    getSessionResult.mockResolvedValue(
      err({ path: "/auth/get-session", reason: "invalid_json" }),
    );

    expect((await request()).status).toBe(503);
    expect(getLabTurn).not.toHaveBeenCalled();
  });

  it("loads the requested turn for an admin session", async () => {
    getSessionResult.mockResolvedValue(ok({ user: { role: "admin" } }));

    const response = await request();

    expect(response.status).toBe(200);
    expect(getLabTurn).toHaveBeenCalledWith("t1");
    await expect(response.json()).resolves.toEqual({ turn: { id: "t1" } });
  });
});
