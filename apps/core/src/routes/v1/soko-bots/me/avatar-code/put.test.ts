import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getStateMock, memberFindFirstMock, resolveMock, setCodeMock } =
  vi.hoisted(() => ({
    getStateMock: vi.fn(),
    memberFindFirstMock: vi.fn(),
    resolveMock: vi.fn(),
    setCodeMock: vi.fn(),
  }));

const USER_ID = "user_1";
const WORKSPACE_ID = "01960001-0001-7001-8001-000000000010";
const BOT_ID = "01960001-0001-7001-8001-000000000099";

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), SOKO_BOT_ENABLED: true }),
  };
});

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

vi.mock("@/middleware/coworker-context", () => ({
  coworkerContextMiddleware: async (_c: unknown, next: () => Promise<void>) =>
    await next(),
}));

vi.mock("@/middleware/organization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/middleware/organization")>();
  return {
    ...actual,
    organizationContextMiddleware: async (
      _c: unknown,
      next: () => Promise<void>,
    ) => await next(),
  };
});

vi.mock("@/middleware/workspace", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/middleware/workspace")>();
  return {
    ...actual,
    workspaceMiddleware: () => async (_c: unknown, next: () => Promise<void>) =>
      await next(),
  };
});

vi.mock("@/helpers/soko-bot-resolver", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/soko-bot-resolver")>();
  return { ...actual, memberSokoBot: resolveMock };
});

vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: vi.fn().mockResolvedValue({ disabled: false }),
  setSokoBotDisabled: vi.fn(),
}));

vi.mock("@/services/soko-bot-state.service", () => ({
  getSokoBotState: getStateMock,
  getSokoBotActivity: vi.fn(),
  listSharedSokoBots: vi.fn(),
}));

vi.mock("@/services/soko-bot-avatar-code.service", () => ({
  setSokoBotAvatarCode: setCodeMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { member: { findFirst: memberFindFirstMock } },
}));

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";

import app from "../../index";

function put(path: string, body: unknown) {
  const parent = new Hono<{
    Variables: EnvVariables["Variables"] & RequestIdVariables;
  }>();
  parent.use("*", async (c, next) => {
    c.set("requestId", "req_avatar_code");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: USER_ID,
      organizationId: null,
      role: "user",
      authenticationMethod: "session",
    });
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      organizationId: "org_1",
    });
    await next();
  });
  parent.onError(errorHandler);
  parent.route("/", app);
  return parent.request(`http://localhost${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const CODE = "v1.owl.golden.peach.crimson.l.M.original.original.none.none";
const RESULT = { avatarCode: CODE, avatarImageUrl: "https://blob.test/c.webp" };
const mine = { id: BOT_ID, userId: USER_ID, workspaceId: WORKSPACE_ID };
const shared = { id: BOT_ID, userId: null, workspaceId: WORKSPACE_ID };

describe("PUT /me/avatar-code and /{sokoBotId}/avatar-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCodeMock.mockResolvedValue(RESULT);
  });

  it("sets the owner's look", async () => {
    resolveMock.mockResolvedValue(mine);

    const response = await put("/me/avatar-code", { code: CODE });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(RESULT);
    expect(setCodeMock).toHaveBeenCalledWith(BOT_ID, CODE);
  });

  it("answers 404 for a bot the caller cannot reach", async () => {
    resolveMock.mockResolvedValue(null);

    expect((await put(`/${BOT_ID}/avatar-code`, { code: CODE })).status).toBe(
      404,
    );
    expect(setCodeMock).not.toHaveBeenCalled();
  });

  it("refuses a plain member changing a shared bot", async () => {
    resolveMock.mockResolvedValue(shared);
    memberFindFirstMock.mockResolvedValue({ role: "member" });

    expect((await put(`/${BOT_ID}/avatar-code`, { code: CODE })).status).toBe(
      403,
    );
    expect(setCodeMock).not.toHaveBeenCalled();
  });

  it("lets an organization admin change a shared bot", async () => {
    resolveMock.mockResolvedValue(shared);
    memberFindFirstMock.mockResolvedValue({ role: "admin" });

    expect((await put(`/${BOT_ID}/avatar-code`, { code: CODE })).status).toBe(
      200,
    );
    expect(setCodeMock).toHaveBeenCalledWith(BOT_ID, CODE);
  });

  it.each([
    [409, "avatar_code_taken"],
    [422, "avatar_code_invalid"],
  ])("passes the service's %s through", async (status, kind) => {
    resolveMock.mockResolvedValue(mine);
    setCodeMock.mockRejectedValue(
      new HTTPException(status as 409 | 422, {
        message: kind,
        cause: { kind },
      }),
    );

    expect((await put("/me/avatar-code", { code: CODE })).status).toBe(status);
  });

  it("answers 422 for an empty body code", async () => {
    resolveMock.mockResolvedValue(mine);

    expect((await put("/me/avatar-code", { code: "" })).status).toBe(422);
    expect(setCodeMock).not.toHaveBeenCalled();
  });
});
