import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { serviceMock, assertAdminSessionMock, revalidatePathMock } = vi.hoisted(
  () => ({
    serviceMock: {
      archiveVersion: vi.fn(),
      createVersion: vi.fn(),
      list: vi.fn(),
      performAction: vi.fn(),
      promoteVersion: vi.fn(),
      updateVersion: vi.fn(),
    },
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

import {
  archiveAdminSokoBotVersionAction,
  createAdminSokoBotVersionAction,
  listAdminSokoBotsAction,
  performAdminSokoBotAction,
  promoteAdminSokoBotVersionAction,
  updateAdminSokoBotVersionAction,
} from "../action";

const VERSION_INPUT = {
  slug: "v12-operator",
  name: "Operator",
  summary: "Handles complex work.",
  model: "anthropic/claude-sonnet-4.5",
  inferenceRegion: "eu",
  systemPrompt: "You are the operator.",
  skills: ["project-manager"],
  capabilities: ["tasks.read", "tasks.write"],
};

const VERSION_DETAIL = {
  id: VERSION_INPUT.slug,
  name: VERSION_INPUT.name,
  createdAt: "2026-08-27",
  summary: VERSION_INPUT.summary,
  model: VERSION_INPUT.model,
  inferenceRegion: VERSION_INPUT.inferenceRegion,
  systemPrompt: VERSION_INPUT.systemPrompt,
  skills: VERSION_INPUT.skills,
  capabilities: VERSION_INPUT.capabilities,
  authored: true,
  isDefault: false,
};

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

  it("rejects an invalid authored-version slug before calling Core", async () => {
    const result = await createAdminSokoBotVersionAction({
      input: { ...VERSION_INPUT, slug: "Not Valid" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
    expect(serviceMock.createVersion).not.toHaveBeenCalled();
  });

  it("creates a version and revalidates the list and detail", async () => {
    serviceMock.createVersion.mockResolvedValue(VERSION_DETAIL);

    const result = await createAdminSokoBotVersionAction({
      input: VERSION_INPUT,
    });

    expect(result).toEqual({ ok: true, value: VERSION_DETAIL });
    expect(serviceMock.createVersion).toHaveBeenCalledWith(VERSION_INPUT);
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/admin/soko-bots/versions",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/admin/soko-bots/versions/v12-operator",
    );
  });

  it("updates a version without allowing its slug to change", async () => {
    serviceMock.updateVersion.mockResolvedValue(VERSION_DETAIL);
    const { slug, ...input } = VERSION_INPUT;

    const result = await updateAdminSokoBotVersionAction({ slug, input });

    expect(result).toEqual({ ok: true, value: VERSION_DETAIL });
    expect(serviceMock.updateVersion).toHaveBeenCalledWith(slug, input);
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/admin/soko-bots/versions/v12-operator",
    );
  });

  it("promotes and archives a valid version slug", async () => {
    serviceMock.promoteVersion.mockResolvedValue({
      defaultVersionId: "v12-operator",
    });
    serviceMock.archiveVersion.mockResolvedValue(undefined);

    await expect(
      promoteAdminSokoBotVersionAction({ slug: "v12-operator" }),
    ).resolves.toEqual({
      ok: true,
      value: { defaultVersionId: "v12-operator" },
    });
    await expect(
      archiveAdminSokoBotVersionAction({ slug: "v12-operator" }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(serviceMock.promoteVersion).toHaveBeenCalledWith("v12-operator");
    expect(serviceMock.archiveVersion).toHaveBeenCalledWith("v12-operator");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/soko-bots");
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/admin/soko-bots/versions",
    );
  });
});
