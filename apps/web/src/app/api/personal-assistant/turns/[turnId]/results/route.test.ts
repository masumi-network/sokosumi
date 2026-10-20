import { ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionResultMock, resultsMock } = vi.hoisted(() => ({
  getSessionResultMock: vi.fn(),
  resultsMock: vi.fn(),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: getSessionResultMock,
}));
vi.mock("@/lib/clients/core.client", () => ({
  coreClientNoRedirect: { getMySokoBotTurnResults: resultsMock },
}));

import { GET } from "./route";

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

function request(query = "") {
  return GET(
    new Request(
      `https://web.test/api/personal-assistant/turns/t1/results${query}`,
    ),
    { params: Promise.resolve({ turnId: "t1" }) },
  );
}

describe("GET /api/personal-assistant/turns/[turnId]/results", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionResultMock.mockResolvedValue(ok({ user: { id: "u1" } }));
    resultsMock.mockResolvedValue({ data: [] });
  });

  it("reads a shared bot's turn when botId names one", async () => {
    const response = await request(`?botId=${BOT_ID}`);
    expect(response.status).toBe(200);
    expect(resultsMock).toHaveBeenCalledWith("t1", BOT_ID);
  });

  it("reads the caller's own turn without botId", async () => {
    await request();
    expect(resultsMock).toHaveBeenCalledWith("t1", undefined);
  });

  it("answers 400 for a botId that is not a bot id", async () => {
    const response = await request("?botId=me");
    expect(response.status).toBe(400);
    expect(resultsMock).not.toHaveBeenCalled();
  });
});
