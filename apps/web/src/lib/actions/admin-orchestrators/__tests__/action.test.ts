import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const updateDisplayMock = vi.fn();
const assertAdminSessionMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

vi.mock("@/lib/auth/admin-access", () => ({
  assertAdminSession: (...args: unknown[]) => assertAdminSessionMock(...args),
}));

vi.mock("@/lib/services/admin-orchestrator.service", () => ({
  adminOrchestratorService: {
    updateDisplay: (...args: unknown[]) => updateDisplayMock(...args),
  },
}));

import { CommonErrorCode } from "@/lib/actions/errors";
import { AdminAccessRequiredError } from "@/lib/auth/errors";
import { ADMIN_ORCHESTRATOR_NAME_MIN_LENGTH } from "@/lib/constants/orchestrator-display";

import { updateAdminOrchestratorDisplayAction } from "../action";

describe("updateAdminOrchestratorDisplayAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertAdminSessionMock.mockImplementation(() => undefined);
  });

  it("updates display metadata for an admin session", async () => {
    const payload = {
      orchestrator: {
        id: "orch_1",
        name: "Hermes",
        slug: "hermes",
        caption: null,
        description: null,
        image: null,
      },
    };
    updateDisplayMock.mockResolvedValue(payload);

    const result = await updateAdminOrchestratorDisplayAction({
      id: "orch_1",
      patchBody: { name: "Hermes" },
      imageIntent: "none",
    });

    expect(assertAdminSessionMock).toHaveBeenCalled();
    expect(updateDisplayMock).toHaveBeenCalledWith({
      id: "orch_1",
      patchBody: { name: "Hermes" },
      imageIntent: "none",
      imageFile: undefined,
    });
    expect(result).toEqual({ ok: true, data: payload });
  });

  it("rejects a non-admin session with UNAUTHORIZED", async () => {
    assertAdminSessionMock.mockImplementation(() => {
      throw new AdminAccessRequiredError();
    });

    const result = await updateAdminOrchestratorDisplayAction({
      id: "orch_1",
      patchBody: { name: "Hermes" },
    });

    expect(updateDisplayMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CommonErrorCode.UNAUTHORIZED);
    }
  });

  it("rejects empty submissions", async () => {
    const result = await updateAdminOrchestratorDisplayAction({
      id: "orch_1",
    });

    expect(updateDisplayMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
    }
  });

  it("strips slug from patch body before calling the service", async () => {
    const payload = {
      orchestrator: {
        id: "orch_1",
        name: "Hermes",
        slug: "hermes",
        caption: "Line",
        description: null,
        image: null,
      },
    };
    updateDisplayMock.mockResolvedValue(payload);

    const result = await updateAdminOrchestratorDisplayAction({
      id: "orch_1",
      patchBody: {
        name: "Hermes",
        caption: "Line",
        slug: "renamed-slug",
      },
      imageIntent: "none",
    });

    expect(updateDisplayMock).toHaveBeenCalledWith({
      id: "orch_1",
      patchBody: { name: "Hermes", caption: "Line" },
      imageIntent: "none",
      imageFile: undefined,
    });
    expect(result).toEqual({ ok: true, data: payload });
  });

  it("rejects a slug-only patch body as empty after sanitize", async () => {
    const result = await updateAdminOrchestratorDisplayAction({
      id: "orch_1",
      patchBody: {
        slug: "renamed-slug",
      },
      imageIntent: "none",
    });

    expect(updateDisplayMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
    }
  });

  it("rejects upload intent without an image file", async () => {
    const result = await updateAdminOrchestratorDisplayAction({
      id: "orch_1",
      imageIntent: "upload",
    });

    expect(updateDisplayMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
      expect(result.error.message).toMatch(/image file/i);
    }
  });

  it("rejects a name shorter than the minimum length", async () => {
    const result = await updateAdminOrchestratorDisplayAction({
      id: "orch_1",
      patchBody: { name: "ab" },
      imageIntent: "none",
    });

    expect(updateDisplayMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
      expect(result.error.message).toContain(
        String(ADMIN_ORCHESTRATOR_NAME_MIN_LENGTH),
      );
    }
  });
});
