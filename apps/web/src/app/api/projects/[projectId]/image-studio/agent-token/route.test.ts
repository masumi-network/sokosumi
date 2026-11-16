import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import { verifyGrant } from "../../../../../../../agents/image-studio/agent/lib/grant";
import { POST } from "./route";

const SECRET = "the-studio-agent-route-test-secret";
const PROJECT_ID = "4a230306-82b9-48a7-8f78-5c50c4be486c";
const mocks = vi.hoisted(() => ({
  getEnvSecrets: vi.fn(),
  getProjectById: vi.fn(),
  readRouteSession: vi.fn(),
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: mocks.getEnvSecrets,
}));
vi.mock("@/lib/auth/route-session", () => ({
  readRouteSession: mocks.readRouteSession,
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { getProjectById: mocks.getProjectById },
}));

function mint() {
  return POST(new NextRequest("https://app.example.test", { method: "POST" }), {
    params: Promise.resolve({ projectId: PROJECT_ID }),
  });
}

describe("Studio assistant token", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("IMAGE_STUDIO_AGENT_SECRET", SECRET);
    mocks.getEnvSecrets.mockReturnValue({ IMAGE_STUDIO_AGENT_SECRET: SECRET });
    mocks.readRouteSession.mockResolvedValue({
      status: "authenticated",
      session: { user: { id: "current-user" } },
    });
    mocks.getProjectById.mockResolvedValue({ id: PROJECT_ID });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("mints a private browser grant that the agent accepts for this project and user", async () => {
    const response = await mint();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { token, expiresAt } = await response.json();
    expect(verifyGrant(token)).toEqual({
      userId: "current-user",
      projectId: PROJECT_ID,
    });
    expect(expiresAt - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(300);
  });

  it("requires an authenticated session before checking project access", async () => {
    mocks.readRouteSession.mockResolvedValue({ status: "signedOut" });
    const response = await mint();
    expect(response.status).toBe(401);
    expect(mocks.getProjectById).not.toHaveBeenCalled();
    expect(await response.json()).not.toHaveProperty("token");
  });

  it("refuses an inaccessible project", async () => {
    mocks.getProjectById.mockRejectedValue(
      new CoreApiRequestError("Denied", { status: 403 }),
    );
    const response = await mint();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "not_found",
      error: "Not found",
    });
  });

  it("distinguishes missing configuration from a retryable session outage", async () => {
    mocks.readRouteSession.mockResolvedValue({ status: "unavailable" });
    const unavailable = await mint();
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      code: "temporarily_unavailable",
    });

    mocks.getEnvSecrets.mockReturnValue({});
    const unconfigured = await mint();
    expect(unconfigured.status).toBe(503);
    expect(await unconfigured.json()).toMatchObject({ code: "not_configured" });
  });
});
