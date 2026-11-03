import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { finalizeAds } = vi.hoisted(() => ({ finalizeAds: vi.fn() }));
vi.mock("../../cmo-actions", () => ({ finalizeAds }));

import { GET } from "./route";

const callback = (query: string) =>
  GET(new NextRequest(`http://localhost:3110/ads/callback?${query}`));

describe("ads callback", () => {
  beforeEach(() => finalizeAds.mockReset());

  it("finishes with the session and goes back to the Accounts step", async () => {
    finalizeAds.mockResolvedValue({ state: "connected" });
    const response = await callback(
      "from=onboarding&status=success&connected_account_id=ca_1&session_uri=s_1",
    );
    expect(finalizeAds).toHaveBeenCalledWith("ca_1", "s_1");
    expect(response.headers.get("location")).toBe(
      "http://localhost:3110/?step=connect",
    );
  });

  it("sends the founder to pick an account when the login reaches several", async () => {
    finalizeAds.mockResolvedValue({
      state: "choose",
      adConnectionId: "conn-1",
    });
    const response = await callback("from=app&connectedAccountId=ca_1");
    expect(response.headers.get("location")).toBe(
      "http://localhost:3110/ads/choose?connection=conn-1&from=app",
    );
  });

  it("says why when nothing was connected", async () => {
    finalizeAds.mockResolvedValue({ state: "none" });
    const none = await callback("from=app&connectedAccountId=ca_1");
    expect(none.headers.get("location")).toBe(
      "http://localhost:3110/channels?ads=none",
    );
    const refused = await callback("from=app&status=failed");
    expect(finalizeAds).toHaveBeenCalledOnce();
    expect(refused.headers.get("location")).toContain("ads=failed");
  });
});
