import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActivityMock } = vi.hoisted(() => ({
  getActivityMock: vi.fn(),
}));

vi.mock("@/lib/clients/core.client", async () => {
  const { CoreApiRequestError } = await import("@/lib/clients/core.request");
  return {
    CoreApiRequestError,
    coreClientNoRedirect: { getMySokoBotActivity: getActivityMock },
  };
});

import { CoreApiRequestError } from "@/lib/clients/core.request";
import { GET } from "./route";

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";
const ACTIVITY = { status: "IDLE", activeTurnId: null, lastTurnAt: null };

function activityRequest(query = "") {
  return new Request(
    `https://web.test/api/personal-assistant/activity${query}`,
  );
}

describe("GET /api/personal-assistant/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("probes the caller's own bot without a bot id", async () => {
    getActivityMock.mockResolvedValue({ data: ACTIVITY });

    const response = await GET(activityRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ activity: ACTIVITY });
    expect(getActivityMock).toHaveBeenCalledWith(undefined);
  });

  it("probes the shared bot named by botId", async () => {
    getActivityMock.mockResolvedValue({ data: ACTIVITY });

    await GET(activityRequest(`?botId=${BOT_ID}`));

    expect(getActivityMock).toHaveBeenCalledWith(BOT_ID);
  });

  it("returns 400 for a bot id that is not a uuid", async () => {
    const response = await GET(activityRequest("?botId=nope"));

    expect(response.status).toBe(400);
    expect(getActivityMock).not.toHaveBeenCalled();
  });

  it("passes Core's status through when the probe fails", async () => {
    getActivityMock.mockRejectedValue(
      new CoreApiRequestError("Not Found", { status: 404 }),
    );

    const response = await GET(activityRequest(`?botId=${BOT_ID}`));

    expect(response.status).toBe(404);
  });
});
