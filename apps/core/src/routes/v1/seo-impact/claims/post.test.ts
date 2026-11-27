import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getEnv } from "@/config/env";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import fixture from "@/test-fixtures/seo-impact-verdict.json";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mount from "./post";

const { claimSeoImpact, recordSeoImpactVerdict } = vi.hoisted(() => ({
  claimSeoImpact: vi.fn(),
  recordSeoImpactVerdict: vi.fn(),
}));
vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));
vi.mock("@/services/seo-impact-claims", () => ({
  claimSeoImpact,
  recordSeoImpactVerdict,
}));

const WORKER = "seo-worker";
const CLAIM_ID = "0196f1a2-7b3c-7d4e-8f50-123456789abc";
const env = getEnv();
const previous = env.SEO_ANALYSIS_EXECUTOR;
const worker = (
  extra: Partial<Extract<AuthenticationContext, { actor: "coworker" }>> = {},
): AuthenticationContext => ({
  actor: "coworker",
  coworkerId: WORKER,
  vendorId: TEST_VENDOR_ID,
  ...extra,
});

function app(authContext: AuthenticationContext) {
  const hono = new OpenAPIHonoWithAuth();
  hono.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    await next();
  });
  mount(hono);
  return hono;
}

const claim = (authContext: AuthenticationContext) =>
  app(authContext).request("/claims", { method: "POST" });
const verdict = (authContext: AuthenticationContext) =>
  app(authContext).request(`/claims/${CLAIM_ID}/verdict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fixture.result),
  });

describe("SEO impact claim routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claimSeoImpact.mockResolvedValue(null);
    recordSeoImpactVerdict.mockResolvedValue({
      impactId: fixture.result.impactId,
      state: fixture.result.state,
    });
    env.SEO_ANALYSIS_EXECUTOR = {
      canUsePaidSearchData: true,
      canSchedule: true,
      mode: "global",
      coworkerId: WORKER,
    };
  });
  afterEach(() => {
    env.SEO_ANALYSIS_EXECUTOR = previous;
  });

  it.each<[string, AuthenticationContext]>([
    [
      "a user",
      { actor: "user", userId: "u1", organizationId: null, role: "user" },
    ],
    ["another coworker", worker({ coworkerId: "someone-else" })],
    [
      "the worker acting for a user",
      worker({ context: { userId: "u1", organizationId: null } }),
    ],
  ])("refuses %s on both routes before the queue", async (_who, actor) => {
    expect((await claim(actor)).status).toBe(403);
    expect((await verdict(actor)).status).toBe(403);
    expect(claimSeoImpact).not.toHaveBeenCalled();
    expect(recordSeoImpactVerdict).not.toHaveBeenCalled();
  });

  it("refuses a scoped executor, which serves one customer only", async () => {
    env.SEO_ANALYSIS_EXECUTOR = {
      canUsePaidSearchData: true,
      canSchedule: true,
      coworkerId: WORKER,
      workspaceId: "w1",
      ownerId: "u1",
      organizationId: null,
    };

    expect((await claim(worker())).status).toBe(403);
    expect((await verdict(worker())).status).toBe(403);
    expect(claimSeoImpact).not.toHaveBeenCalled();
  });

  it("lets the global worker claim and post its verdict", async () => {
    const claimed = {
      claimId: CLAIM_ID,
      claimedUntil: "2026-06-03T12:30:00.000Z",
      input: fixture.input,
    };
    claimSeoImpact.mockResolvedValue(claimed);
    const response = await claim(worker());
    expect(response.status).toBe(200);
    // The claimId is a lease: no cache may hand it to another caller.
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ data: claimed });
    expect(claimSeoImpact).toHaveBeenCalledOnce();
    expect((await verdict(worker())).status).toBe(200);
    expect(recordSeoImpactVerdict).toHaveBeenCalledWith(
      CLAIM_ID,
      fixture.result,
    );
  });
});
