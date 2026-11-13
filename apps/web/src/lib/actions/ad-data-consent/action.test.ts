import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/lib/services/ad-data-consent.service", () => ({
  adDataConsentService: { save: mocks.save },
}));
vi.mock("@/lib/clients/core.client", () => ({
  toCoreApiActionError: () => ({ code: "UNAUTHORIZED" }),
}));
vi.mock("@/middleware/auth-middleware", () => ({
  withSession: (handler: (params: object) => unknown) => handler,
}));

import { saveAdDataConsent } from "./action";

const WORKSPACE_ID = "019ac5bb-3ac1-7000-8000-000000000001";
beforeEach(() => vi.resetAllMocks());

describe("saveAdDataConsent", () => {
  it("rejects training without improvement sharing before calling Core", async () => {
    const result = await saveAdDataConsent({
      workspaceId: WORKSPACE_ID,
      shareForImprovement: false,
      allowTraining: true,
    });
    expect(result.ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("returns the saved consent from Core", async () => {
    const consent = {
      workspaceId: WORKSPACE_ID,
      shareForImprovement: true,
      allowTraining: true,
      decidedAt: null,
      policyVersion: "2026-11-13",
    };
    mocks.save.mockResolvedValue(consent);
    expect(
      await saveAdDataConsent({
        workspaceId: WORKSPACE_ID,
        shareForImprovement: true,
        allowTraining: true,
      }),
    ).toEqual({ ok: true, value: consent });
    expect(mocks.save).toHaveBeenCalledWith(WORKSPACE_ID, true, true);
  });

  it("returns a Core permission failure without claiming the change was saved", async () => {
    mocks.save.mockRejectedValue(new Error("Forbidden"));
    expect(
      await saveAdDataConsent({
        workspaceId: WORKSPACE_ID,
        shareForImprovement: true,
        allowTraining: false,
      }),
    ).toEqual({ ok: false, error: { code: "UNAUTHORIZED" } });
  });
});
