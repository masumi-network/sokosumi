import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { finalizeChannel } = vi.hoisted(() => ({ finalizeChannel: vi.fn() }));
vi.mock("../../cmo-actions", () => ({ finalizeChannel }));

import { GET } from "./route";

const callback = (query: string) =>
  GET(new NextRequest(`http://localhost:3110/connect/callback?${query}`));

describe("connect callback", () => {
  beforeEach(() => finalizeChannel.mockReset());

  it("finishes the connection and resumes onboarding on Accounts", async () => {
    finalizeChannel.mockResolvedValue(true);
    const response = await callback(
      "from=onboarding&project=project-2&status=success&connectedAccountId=ca_1&session_uri=s_1",
    );
    expect(finalizeChannel).toHaveBeenCalledWith("project-2", "ca_1", "s_1");
    expect(response.headers.get("location")).toBe(
      "http://localhost:3110/?step=connect&from=onboarding",
    );
  });

  it("says it failed when the provider refused", async () => {
    const response = await callback(
      "project=project-2&status=failed&connectedAccountId=ca_1",
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
