import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { serviceMock, revalidatePathMock, MockCoreApiRequestError } = vi.hoisted(
  () => {
    class MockCoreApiRequestError extends Error {
      status?: number;
      constructor(message: string, status?: number) {
        super(message);
        this.status = status;
      }
    }
    return {
      serviceMock: {
        getMine: vi.fn(),
        createOrUpdate: vi.fn(),
        updateAutonomy: vi.fn(),
        startTurn: vi.fn(),
        resolveDecision: vi.fn(),
        createSchedule: vi.fn(),
      },
      revalidatePathMock: vi.fn(),
      MockCoreApiRequestError,
    };
  },
);

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler({ ...(params as object), session: { user: {} } }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: MockCoreApiRequestError,
  toCoreApiActionError: (error: unknown) => ({
    code: "INTERNAL_SERVER_ERROR",
    message: error instanceof Error ? error.message : "unknown",
  }),
}));

vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: serviceMock,
}));

import { CommonErrorCode } from "@/lib/actions/errors";
import {
  SOKO_BOT_BUSY_ERROR_CODE,
  SOKO_BOT_ROUTE,
} from "@/lib/soko-bot/constants";

import {
  createSokoBotAction,
  createSokoBotScheduleAction,
  resolveSokoBotDecisionAction,
  startSokoBotTurnAction,
  updateSokoBotAutonomyAction,
} from "../action";

describe("soko-bot actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createSokoBotAction validates input and revalidates the route", async () => {
    serviceMock.createOrUpdate.mockResolvedValue({ id: "bot_1" });
    const ok = await createSokoBotAction({
      input: { name: "  Atlas ", autonomyLevel: "SUPERVISED" },
    });
    expect(ok).toEqual({ ok: true, value: { id: "bot_1" } });
    expect(serviceMock.createOrUpdate).toHaveBeenCalledWith({
      name: "Atlas",
      autonomyLevel: "SUPERVISED",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(SOKO_BOT_ROUTE);

    const bad = await createSokoBotAction({
      input: { name: "", autonomyLevel: "SUPERVISED" },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe(CommonErrorCode.BAD_INPUT);
    expect(serviceMock.createOrUpdate).toHaveBeenCalledTimes(1);
  });

  it("updateSokoBotAutonomyAction rejects unknown levels and missing bots", async () => {
    const bad = await updateSokoBotAutonomyAction({ autonomyLevel: "MAX" });
    expect(bad.ok).toBe(false);

    serviceMock.getMine.mockResolvedValue(null);
    const missing = await updateSokoBotAutonomyAction({
      autonomyLevel: "AUTONOMOUS",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe(CommonErrorCode.NOT_FOUND);

    serviceMock.getMine.mockResolvedValue({ id: "bot_1", name: "Atlas" });
    serviceMock.updateAutonomy.mockResolvedValue({ id: "bot_1" });
    const good = await updateSokoBotAutonomyAction({
      autonomyLevel: "AUTONOMOUS",
    });
    expect(good.ok).toBe(true);
    expect(serviceMock.updateAutonomy).toHaveBeenCalledWith(
      { id: "bot_1", name: "Atlas" },
      "AUTONOMOUS",
    );
  });

  it("startSokoBotTurnAction maps Core 409 to the busy error code", async () => {
    serviceMock.startTurn.mockRejectedValue(
      new MockCoreApiRequestError("Soko Bot is already working", 409),
    );
    const result = await startSokoBotTurnAction({
      input: { clientTurnId: "c1", message: "hi" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(SOKO_BOT_BUSY_ERROR_CODE);
  });

  it("startSokoBotTurnAction returns the accepted turn", async () => {
    serviceMock.startTurn.mockResolvedValue({ turnId: "t1", duplicate: false });
    const result = await startSokoBotTurnAction({
      input: { clientTurnId: "c1", message: " hello " },
    });
    expect(result).toEqual({
      ok: true,
      value: { turnId: "t1", duplicate: false },
    });
    expect(serviceMock.startTurn).toHaveBeenCalledWith({
      clientTurnId: "c1",
      message: "hello",
    });
  });

  it("resolveSokoBotDecisionAction only accepts ACCEPT/REJECT", async () => {
    const bad = await resolveSokoBotDecisionAction({
      decisionId: "d1",
      resolution: "MAYBE",
    });
    expect(bad.ok).toBe(false);
    expect(serviceMock.resolveDecision).not.toHaveBeenCalled();

    serviceMock.resolveDecision.mockResolvedValue({ id: "d1" });
    const good = await resolveSokoBotDecisionAction({
      decisionId: "d1",
      resolution: "REJECT",
    });
    expect(good.ok).toBe(true);
    expect(serviceMock.resolveDecision).toHaveBeenCalledWith("d1", {
      resolution: "REJECT",
    });
  });

  it("createSokoBotScheduleAction requires all schedule fields", async () => {
    const bad = await createSokoBotScheduleAction({
      input: { name: "Digest", cronExpression: "0 9 * * *" },
    });
    expect(bad.ok).toBe(false);
    expect(serviceMock.createSchedule).not.toHaveBeenCalled();
  });
});
