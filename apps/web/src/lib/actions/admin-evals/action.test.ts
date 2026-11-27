import type { Session } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRun: vi.fn(),
  assertAdmin: vi.fn(),
}));
vi.mock("@/lib/services/admin-evals.service", () => ({
  adminEvalsService: { createRun: mocks.createRun },
}));
vi.mock("@/lib/auth/admin-access", () => ({
  assertAdminSession: mocks.assertAdmin,
}));
vi.mock("@/lib/clients/core.client", () => ({
  toCoreApiActionError: (error: Error) => ({
    code: "BAD_INPUT",
    message: error.message,
  }),
}));
vi.mock("@/middleware/auth-middleware", () => ({
  withSession: (handler: (params: object) => unknown) => handler,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createAdminEvalRunAction } from "./action";

const SESSION = {
  user: { id: "admin-1", role: "admin" },
  session: { id: "session-1" },
} as Session;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createRun.mockResolvedValue({ id: "run-1" });
});

describe("createAdminEvalRunAction", () => {
  it("passes the chosen versions to Core", async () => {
    const result = await createAdminEvalRunAction({
      session: SESSION,
      suites: ["cmo"],
      repeats: 1,
      caseIds: ["cmo-strategy-cal-com"],
      cusoVersionId: "cmo-v22",
      sokoBotVersionId: "v36",
    });

    expect(result).toEqual({ ok: true, value: { id: "run-1" } });
    expect(mocks.createRun).toHaveBeenCalledWith({
      suites: ["cmo"],
      repeats: 1,
      caseIds: ["cmo-strategy-cal-com"],
      cusoVersionId: "cmo-v22",
      sokoBotVersionId: "v36",
    });
  });

  it("leaves the versions to Core's defaults when none is chosen", async () => {
    await createAdminEvalRunAction({
      session: SESSION,
      suites: ["soko-bot", "cmo"],
      repeats: 2,
      caseIds: [],
    });

    expect(mocks.createRun).toHaveBeenCalledWith({
      suites: ["soko-bot", "cmo"],
      repeats: 2,
      caseIds: undefined,
      cusoVersionId: undefined,
      sokoBotVersionId: undefined,
    });
  });

  it("refuses a version id Core could not hold", async () => {
    const result = await createAdminEvalRunAction({
      session: SESSION,
      suites: ["cmo"],
      repeats: 1,
      cusoVersionId: "x".repeat(42),
    });

    expect(result.ok).toBe(false);
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it("returns Core's refusal of an unknown version", async () => {
    mocks.createRun.mockRejectedValue(
      new Error("Unknown or unapproved version: cmo-v99"),
    );

    expect(
      await createAdminEvalRunAction({
        session: SESSION,
        suites: ["cmo"],
        repeats: 1,
        cusoVersionId: "cmo-v99",
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "BAD_INPUT",
        message: "Unknown or unapproved version: cmo-v99",
      },
    });
  });
});
