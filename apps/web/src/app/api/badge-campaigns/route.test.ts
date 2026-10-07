import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }));
vi.mock("@/lib/clients/core.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/clients/core.client")>();
  return { ...actual, coreClientNoRedirect: { getMyBadgeCampaigns: loadMock } };
});

import { CoreApiRequestError } from "@/lib/clients/core.request";
import { GET } from "./route";

describe("badge background read", () => {
  beforeEach(() => vi.resetAllMocks());
  it("returns only the Core caller's campaigns without caching", async () => {
    loadMock.mockResolvedValue([
      {
        id: "campaign",
        feature: "DRIVE",
        endsAt: new Date("2026-10-22T00:00:00Z"),
      },
    ]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).data.badgeCampaigns).toHaveLength(1);
  });
  it("answers 401 without a sign-in redirect on logout", async () => {
    loadMock.mockRejectedValue(
      new CoreApiRequestError("Unauthorized", { status: 401 }),
    );
    const response = await GET();
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
  });
  it("answers a failed Core read without leaking details", async () => {
    loadMock.mockRejectedValue(new Error("internal detail"));
    const response = await GET();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Badge campaigns unavailable",
    });
  });
});
