import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { finalizeChannel, keepChannelSignIn } = vi.hoisted(() => ({
  finalizeChannel: vi.fn(),
  keepChannelSignIn: vi.fn(),
}));
vi.mock("../../cmo-actions", () => ({ finalizeChannel, keepChannelSignIn }));

import { GET } from "./route";

const callback = (query: string) =>
  GET(new NextRequest(`http://localhost:3110/connect/callback?${query}`));

describe("connect callback", () => {
  beforeEach(() => {
    finalizeChannel.mockReset();
    keepChannelSignIn.mockReset();
  });

  it("finishes the connection and resumes onboarding on Accounts", async () => {
    finalizeChannel.mockResolvedValue({ state: "connected" });
    const response = await callback(
      "from=onboarding&project=project-2&status=success&connectedAccountId=ca_1&session_uri=s_1",
    );
    expect(finalizeChannel).toHaveBeenCalledWith("project-2", {
      connectionId: "ca_1",
      sessionUri: "s_1",
      callbackProof: null,
      pendingDataToken: null,
      connectToken: null,
    });
    expect(response.headers.get("location")).toBe(
      "http://localhost:3110/?step=connect&from=onboarding&project=project-2",
    );
  });

  it("finishes TikTok with its one-use proof, back at /zernio/callback", async () => {
    finalizeChannel.mockResolvedValue({ state: "connected" });
    const { GET: zernio } = await import("../../zernio/callback/route");
    const response = await zernio(
      new NextRequest(
        "http://localhost:3110/zernio/callback?project=project-2&from=app&connection=zernio:0123456789abcdef01234567&proof=one-use",
      ),
    );
    expect(finalizeChannel).toHaveBeenCalledWith("project-2", {
      connectionId: "zernio:0123456789abcdef01234567",
      sessionUri: null,
      callbackProof: "one-use",
      pendingDataToken: null,
      connectToken: null,
    });
    expect(response.headers.get("location")).toBe(
      "http://localhost:3110/?step=connect&from=app&project=project-2",
    );
  });

  it("says it failed when the provider refused", async () => {
    const response = await callback(
      "project=project-2&status=failed&connectedAccountId=ca_1",
    );
    expect(finalizeChannel).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("connect=failed");
  });

  it("goes to the picker when LinkedIn reaches Pages, with the sign-in kept out of the address", async () => {
    finalizeChannel.mockResolvedValue({ state: "choose", choices: [] });
    const { GET: zernio } = await import("../../zernio/callback/route");
    const response = await zernio(
      new NextRequest(
        "http://localhost:3110/zernio/callback?project=project-2&from=app&connection=zernio:p1&proof=one-use&pendingDataToken=pending&connect_token=connect&session_uri=s_1",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "http://localhost:3110/connect/choose",
    );
    expect(keepChannelSignIn).toHaveBeenCalledWith({
      project: "project-2",
      from: "app",
      signIn: {
        connectionId: "zernio:p1",
        sessionUri: null,
        callbackProof: "one-use",
        pendingDataToken: "pending",
        connectToken: "connect",
      },
    });
  });

  it("carries the reason a connection kept no account", async () => {
    finalizeChannel.mockResolvedValue({ state: "failed", reason: "no_page" });
    const response = await callback(
      "from=app&project=project-2&connectedAccountId=ca_1",
    );
    expect(response.headers.get("location")).toContain("connect=no_page");
  });

  it("finishes nothing when the network reports an error", async () => {
    const response = await callback(
      "project=project-2&connection=zernio:p1&proof=one-use&error=oauth_denied&platform=linkedin",
    );
    expect(finalizeChannel).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("connect=failed");
  });

  it("finishes nothing without the Project it started from", async () => {
    const response = await callback("from=app&connectedAccountId=ca_1");
    expect(finalizeChannel).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("connect=failed");
  });
});
