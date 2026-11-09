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
        startTurn: vi.fn(),
        resolveDecision: vi.fn(),
        createSchedule: vi.fn(),
        topUpAvatars: vi.fn(),
        createScoped: vi.fn(),
        archive: vi.fn(),
        reactivate: vi.fn(),
        resetMemory: vi.fn(),
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

import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import {
  SOKO_BOT_AVATAR_RATE_LIMITED_ERROR_CODE,
  SOKO_BOT_BUSY_ERROR_CODE,
  SOKO_BOT_ROUTE,
  SOKO_BOTS_ROUTE,
} from "@/lib/soko-bot/constants";

import {
  archiveSokoBotAction,
  createScopedSokoBotAction,
  createSokoBotAction,
  createSokoBotScheduleAction,
  reactivateSokoBotAction,
  resetSokoBotMemoryAction,
  resolveSokoBotDecisionAction,
  startSokoBotTurnAction,
  topUpSokoBotAvatarsAction,
} from "../action";

describe("soko-bot actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createSokoBotAction validates input and revalidates the route", async () => {
    serviceMock.createOrUpdate.mockResolvedValue({ id: "bot_1" });
    const ok = await createSokoBotAction({
      input: { name: "  Atlas " },
    });
    expect(ok).toEqual({ ok: true, value: { id: "bot_1" } });
    expect(serviceMock.createOrUpdate).toHaveBeenCalledWith({
      name: "Atlas",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(SOKO_BOT_ROUTE);

    const bad = await createSokoBotAction({
      input: { name: "" },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe(CommonErrorCode.BAD_INPUT);
    expect(serviceMock.createOrUpdate).toHaveBeenCalledTimes(1);
  });

  it("topUpSokoBotAvatarsAction maps Core 429 to the rate-limited code", async () => {
    // The picker shows a different sentence for this one: a spent allowance is
    // a wait, not a breakage, and "could not load" tells the user to retry now.
    serviceMock.topUpAvatars.mockRejectedValue(
      new MockCoreApiRequestError("Too many pictures requested", 429),
    );
    const result = await topUpSokoBotAvatarsAction({ input: { take: 6 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(SOKO_BOT_AVATAR_RATE_LIMITED_ERROR_CODE);
    }
  });

  it("topUpSokoBotAvatarsAction leaves other Core failures generic", async () => {
    // Pins the mapping to 429 alone. Without this, mapping every status to the
    // rate-limit code would still pass the test above.
    serviceMock.topUpAvatars.mockRejectedValue(
      new MockCoreApiRequestError("Boom", 500),
    );
    const result = await topUpSokoBotAvatarsAction({ input: { take: 6 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
    }
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
    expect(serviceMock.startTurn).toHaveBeenCalledWith(
      {
        clientTurnId: "c1",
        message: "hello",
      },
      undefined,
    );
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
    expect(serviceMock.resolveDecision).toHaveBeenCalledWith(
      "d1",
      { resolution: "REJECT" },
      undefined,
    );
  });

  it("createSokoBotScheduleAction requires all schedule fields", async () => {
    const bad = await createSokoBotScheduleAction({
      input: { name: "Digest", cronExpression: "0 9 * * *" },
    });
    expect(bad.ok).toBe(false);
    expect(serviceMock.createSchedule).not.toHaveBeenCalled();
  });

  it("topUpSokoBotAvatarsAction refuses a take above one generation batch", async () => {
    const bad = await topUpSokoBotAvatarsAction({
      input: { take: 12, excludeIds: [] },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe(CommonErrorCode.BAD_INPUT);
    expect(serviceMock.topUpAvatars).not.toHaveBeenCalled();
  });

  describe("shared bots", () => {
    const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

    it("archives the shared bot named by botId and refreshes its pages", async () => {
      serviceMock.archive.mockResolvedValue(undefined);
      const result = await archiveSokoBotAction({ botId: BOT_ID });
      expect(result.ok).toBe(true);
      expect(serviceMock.archive).toHaveBeenCalledWith(BOT_ID);
      expect(revalidatePathMock).toHaveBeenCalledWith(
        `${SOKO_BOTS_ROUTE}/${BOT_ID}`,
      );
      expect(revalidatePathMock).toHaveBeenCalledWith(SOKO_BOTS_ROUTE);
    });

    it("reactivates the shared bot named by botId and refreshes its pages", async () => {
      serviceMock.reactivate.mockResolvedValue(undefined);
      const result = await reactivateSokoBotAction({ botId: BOT_ID });
      expect(result.ok).toBe(true);
      expect(serviceMock.reactivate).toHaveBeenCalledWith(BOT_ID);
      expect(revalidatePathMock).toHaveBeenCalledWith(
        `${SOKO_BOTS_ROUTE}/${BOT_ID}`,
      );
      expect(revalidatePathMock).toHaveBeenCalledWith(SOKO_BOTS_ROUTE);
    });

    it.each([
      ["no botId", undefined],
      ["a botId that is not a uuid", "me"],
    ])("refuses to reactivate with %s", async (_label, botId) => {
      const result = await reactivateSokoBotAction({ botId });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
      expect(serviceMock.reactivate).not.toHaveBeenCalled();
    });

    it("archives the caller's own bot without a botId", async () => {
      serviceMock.archive.mockResolvedValue(undefined);
      await archiveSokoBotAction({});
      expect(serviceMock.archive).toHaveBeenCalledWith(undefined);
      expect(revalidatePathMock).toHaveBeenCalledWith(SOKO_BOT_ROUTE);
    });

    it("refuses a botId that is not a uuid before calling Core", async () => {
      const result = await resetSokoBotMemoryAction({ botId: "me" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
      expect(serviceMock.resetMemory).not.toHaveBeenCalled();
    });

    it("passes botId through to a schedule", async () => {
      serviceMock.createSchedule.mockResolvedValue({ id: "s1" });
      const input = {
        name: "Digest",
        timezone: "Europe/Berlin",
        cronExpression: "0 9 * * *",
        prompt: "Sum up",
      };
      await createSokoBotScheduleAction({ input, botId: BOT_ID });
      expect(serviceMock.createSchedule).toHaveBeenCalledWith(input, BOT_ID);
    });

    it("creates a project bot with its project", async () => {
      serviceMock.createScoped.mockResolvedValue({ id: BOT_ID });
      const projectId = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
      const result = await createScopedSokoBotAction({
        input: { name: " Launch bot ", scope: "project", projectId },
      });
      expect(result).toEqual({ ok: true, value: { id: BOT_ID } });
      expect(serviceMock.createScoped).toHaveBeenCalledWith({
        name: "Launch bot",
        scope: "project",
        projectId,
      });
      expect(revalidatePathMock).toHaveBeenCalledWith(SOKO_BOTS_ROUTE);
    });

    it("refuses a project bot without a project, and a project on another scope", async () => {
      const noProject = await createScopedSokoBotAction({
        input: { name: "Bot", scope: "project" },
      });
      const strayProject = await createScopedSokoBotAction({
        input: {
          name: "Bot",
          scope: "workspace",
          projectId: "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d",
        },
      });
      expect(noProject.ok).toBe(false);
      expect(strayProject.ok).toBe(false);
      expect(serviceMock.createScoped).not.toHaveBeenCalled();
    });

    it("passes the creator's timezone and refuses an unknown scope", async () => {
      serviceMock.createScoped.mockResolvedValue({ id: BOT_ID });
      await createScopedSokoBotAction({
        input: { name: "Ops", scope: "workspace", timezone: "Europe/Berlin" },
      });
      expect(serviceMock.createScoped).toHaveBeenCalledWith({
        name: "Ops",
        scope: "workspace",
        timezone: "Europe/Berlin",
      });
      const unknown = await createScopedSokoBotAction({
        input: { name: "Ops", scope: "team" },
      });
      expect(unknown.ok).toBe(false);
      expect(serviceMock.createScoped).toHaveBeenCalledTimes(1);
    });

    it("returns Core's refusal when creating fails", async () => {
      serviceMock.createScoped.mockRejectedValue(
        new MockCoreApiRequestError("Forbidden", 403),
      );
      const result = await createScopedSokoBotAction({
        input: { name: "Bot", scope: "workspace" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toBe("Forbidden");
    });
  });
});
