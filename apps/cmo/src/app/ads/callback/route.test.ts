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
      "from=onboarding&project=project-2&status=success&connected_account_id=ca_1&session_uri=s_1",
    );
    expect(finalizeAds).toHaveBeenCalledWith("project-2", "ca_1", "s_1");
    expect(response.headers.get("location")).toBe(
      "http://localhost:3110/?step=connect&from=onboarding&project=project-2",
    );
  });

  it("sends the founder to pick an account when the login reaches several", async () => {
    finalizeAds.mockResolvedValue({
      state: "choose",
      adConnectionId: "conn-1",
    });
    const response = await callback(
      "from=app&project=project-2&connectedAccountId=ca_1",
    );
    expect(response.headers.get("location")).toBe(
      "http://localhost:3110/ads/choose?connection=conn-1&project=project-2&from=app",
    );
  });

  it("says why when nothing was connected", async () => {
    finalizeAds.mockResolvedValue({ state: "none" });
    const none = await callback(
      "from=app&project=project-2&connectedAccountId=ca_1",
    );
    expect(none.headers.get("location")).toBe(
      "http://localhost:3110/channels?ads=none&project=project-2",
    );
    const refused = await callback("from=app&project=project-2&status=failed");
    expect(finalizeAds).toHaveBeenCalledOnce();
    expect(refused.headers.get("location")).toContain("ads=failed");
  });

  it("finishes nothing without the Project it started from", async () => {
    const response = await callback("from=app&connectedAccountId=ca_1");
    expect(finalizeAds).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("ads=failed");
  });

  it("ends a popup's connect on the page that tells the opener", async () => {
    finalizeAds.mockResolvedValue({ state: "connected" });
    const done = await callback("from=popup&project=project-2&connectedAccountId=ca_1");
    expect(done.headers.get("location")).toBe(
      "http://localhost:3110/connect/done?result=connected",
    );
    finalizeAds.mockResolvedValue({ state: "none" });
    const none = await callback("from=popup&project=project-2&connectedAccountId=ca_1");
    expect(none.headers.get("location")).toBe(
      "http://localhost:3110/connect/done?result=none",
    );
    const refused = await callback("from=popup&project=project-2&status=failed");
    expect(refused.headers.get("location")).toBe(
      "http://localhost:3110/connect/done?result=failed",
    );
  });

  it("lets a popup pick the account, then still ends on the done page", async () => {
    finalizeAds.mockResolvedValue({
      state: "choose",
      adConnectionId: "conn-1",
    });
    const response = await callback("from=popup&project=project-2&connectedAccountId=ca_1");
    expect(response.headers.get("location")).toBe(
      "http://localhost:3110/ads/choose?connection=conn-1&project=project-2&from=popup",
    );
  });
});
