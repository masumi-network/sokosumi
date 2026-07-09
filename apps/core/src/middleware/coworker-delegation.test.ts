import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import type { AuthVariables } from "./auth";
import { coworkerDelegationMiddleware } from "./coworker-delegation";

const { memberFindUniqueMock, userFindUniqueMock } = vi.hoisted(() => ({
  memberFindUniqueMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
    member: {
      findUnique: memberFindUniqueMock,
    },
  },
}));

function createApp(initial: AuthVariables) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", initial.isAuthenticated);
    c.set("authContext", initial.authContext);
    await next();
  });
  app.use("*", coworkerDelegationMiddleware);
  app.get("/", (c) => c.json({ authContext: c.var.authContext }));
  return app;
}

describe("coworkerDelegationMiddleware", () => {
  beforeEach(() => {
    memberFindUniqueMock.mockReset();
    userFindUniqueMock.mockReset();
  });

  it("does not change user authentication context when delegation headers are present", async () => {
    const app = createApp({
      isAuthenticated: true,
      authContext: {
        actor: "user",
        userId: "user_1",
        organizationId: "org_1",
        role: "user",
      },
    });

    const res = await app.request("http://localhost/", {
      headers: {
        "X-Delegation-User-Id": "delegated_user",
        "X-Delegation-Organization-Id": "delegated_org",
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authContext: AuthVariables["authContext"];
    };
    expect(body.authContext).toEqual({
      actor: "user",
      userId: "user_1",
      organizationId: "org_1",
      role: "user",
    });
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });

  it("leaves coworker context unchanged when delegation headers are absent", async () => {
    const app = createApp({
      isAuthenticated: true,
      authContext: {
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: TEST_VENDOR_ID,
      },
    });

    const res = await app.request("http://localhost/");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authContext: AuthVariables["authContext"];
    };
    expect(body.authContext).toEqual({
      actor: "coworker",
      coworkerId: "cow_1",
      vendorId: TEST_VENDOR_ID,
    });
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });

  it("attaches delegation with null organization when only user id header is set", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user_delegated" });

    const app = createApp({
      isAuthenticated: true,
      authContext: {
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: TEST_VENDOR_ID,
      },
    });

    const res = await app.request("http://localhost/", {
      headers: { "X-Delegation-User-Id": "  user_delegated  " },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authContext: AuthVariables["authContext"];
    };
    expect(body.authContext).toEqual({
      actor: "coworker",
      coworkerId: "cow_1",
      vendorId: TEST_VENDOR_ID,
      delegation: { userId: "user_delegated", organizationId: null },
    });
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "user_delegated" },
      select: { id: true },
    });
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });

  it("currently allows delegation to any valid user even when unrelated to the coworker", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user_arbitrary" });

    const app = createApp({
      isAuthenticated: true,
      authContext: {
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: TEST_VENDOR_ID,
      },
    });

    const res = await app.request("http://localhost/", {
      headers: { "X-Delegation-User-Id": "user_arbitrary" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authContext: AuthVariables["authContext"];
    };
    expect(body.authContext).toEqual({
      actor: "coworker",
      coworkerId: "cow_1",
      vendorId: TEST_VENDOR_ID,
      delegation: { userId: "user_arbitrary", organizationId: null },
    });
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "user_arbitrary" },
      select: { id: true },
    });
  });

  it("attaches delegation with organization when both headers are set and user is a member", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "u1" });
    memberFindUniqueMock.mockResolvedValue({ userId: "u1" });

    const app = createApp({
      isAuthenticated: true,
      authContext: {
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: TEST_VENDOR_ID,
      },
    });

    const res = await app.request("http://localhost/", {
      headers: {
        "X-Delegation-User-Id": "u1",
        "X-Delegation-Organization-Id": "  org_1  ",
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authContext: AuthVariables["authContext"];
    };
    expect(body.authContext).toEqual({
      actor: "coworker",
      coworkerId: "cow_1",
      vendorId: TEST_VENDOR_ID,
      delegation: { userId: "u1", organizationId: "org_1" },
    });
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { id: true },
    });
    expect(memberFindUniqueMock).toHaveBeenCalledWith({
      where: {
        userId_organizationId: { userId: "u1", organizationId: "org_1" },
      },
      select: { userId: true },
    });
  });

  it("returns 400 when delegated user is not a member of the delegated organization", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "u1" });
    memberFindUniqueMock.mockResolvedValue(null);

    const app = createApp({
      isAuthenticated: true,
      authContext: {
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: TEST_VENDOR_ID,
      },
    });

    const res = await app.request("http://localhost/", {
      headers: {
        "X-Delegation-User-Id": "u1",
        "X-Delegation-Organization-Id": "org_1",
      },
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when delegated user does not exist", async () => {
    userFindUniqueMock.mockResolvedValue(null);

    const app = createApp({
      isAuthenticated: true,
      authContext: {
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: TEST_VENDOR_ID,
      },
    });

    const res = await app.request("http://localhost/", {
      headers: { "X-Delegation-User-Id": "missing_user" },
    });

    expect(res.status).toBe(400);
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 400 when organization delegation header is set without user id", async () => {
    const app = createApp({
      isAuthenticated: true,
      authContext: {
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: TEST_VENDOR_ID,
      },
    });

    const res = await app.request("http://localhost/", {
      headers: { "X-Delegation-Organization-Id": "org_only" },
    });

    expect(res.status).toBe(400);
  });
});
