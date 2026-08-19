import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { serviceMock, assertAdminSessionMock, revalidatePathMock } = vi.hoisted(
  () => ({
    serviceMock: { list: vi.fn(), performAction: vi.fn() },
    assertAdminSessionMock: vi.fn(),
    revalidatePathMock: vi.fn(),
  }),
);

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler({ ...(params as object), session: { user: {} } }),
}));

vi.mock("@/lib/auth/admin-access", () => ({
  assertAdminSession: (...args: unknown[]) => assertAdminSessionMock(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/lib/services/admin-soko-bot.service", () => ({
  adminSokoBotService: serviceMock,
}));

import { CommonErrorCode } from "@/lib/actions/errors";
import { AdminAccessRequiredError } from "@/lib/auth/errors";

import { listAdminSokoBotsAction, performAdminSokoBotAction } from "../action";

describe("admin soko-bot actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists bots for an admin session", async () => {
    serviceMock.list.mockResolvedValue({ items: [], total: 0 });
    const result = await listAdminSokoBotsAction({ query: "ada", limit: 10 });
    expect(assertAdminSessionMock).toHaveBeenCalled();
    expect(serviceMock.list).toHaveBeenCalledWith({ query: "ada", limit: 10 });
    expect(result).toEqual({ ok: true, value: { items: [], total: 0 } });
  });

  it("maps admin access errors to UNAUTHORIZED", async () => {
    assertAdminSessionMock.mockImplementationOnce(() => {
      throw new AdminAccessRequiredError();
    });
    const result = await performAdminSokoBotAction({
      input: {
        sokoBotId: "bot_1",
        action: "PAUSE",
        reason: "Investigating",
        operationId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe(CommonErrorCode.UNAUTHORIZED);
    expect(serviceMock.performAction).not.toHaveBeenCalled();
  });

  it("requires a uuid operationId", async () => {
    const result = await performAdminSokoBotAction({
      input: {
        sokoBotId: "bot_1",
        action: "PAUSE",
        reason: "Investigating",
        operationId: "not-a-uuid",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
    expect(serviceMock.performAction).not.toHaveBeenCalled();
  });

  it("requires a reason and a known action", async () => {
    const noReason = await performAdminSokoBotAction({
      input: {
        sokoBotId: "bot_1",
        action: "PAUSE",
        reason: "x",
        operationId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      },
    });
    expect(noReason.ok).toBe(false);
    if (!noReason.ok)
      expect(noReason.error.code).toBe(CommonErrorCode.BAD_INPUT);

    const unknown = await performAdminSokoBotAction({
      input: {
        sokoBotId: "bot_1",
        action: "DELETE",
        reason: "Because",
        operationId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      },
    });
    expect(unknown.ok).toBe(false);
    expect(serviceMock.performAction).not.toHaveBeenCalled();
  });

  it("performs the action and revalidates fleet + detail routes", async () => {
    serviceMock.performAction.mockResolvedValue({ id: "bot_1" });
    const operationId = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
    const result = await performAdminSokoBotAction({
      input: {
        sokoBotId: "bot_1",
        action: "RESET_MEMORY",
        reason: "  Corrupt notes  ",
        operationId,
      },
    });
    expect(result).toEqual({ ok: true, value: { id: "bot_1" } });
    expect(serviceMock.performAction).toHaveBeenCalledWith("bot_1", {
      action: "RESET_MEMORY",
      targetId: undefined,
      operationId,
      reason: "Corrupt notes",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/soko-bots");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/soko-bots/bot_1");
  });
});
