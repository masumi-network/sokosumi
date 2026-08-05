import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import type { AuthVariables } from "./auth";
import { coworkerContextMiddleware } from "./coworker-context";

const {
  memberFindUniqueMock,
  userFindUniqueMock,
  orchestratorFindFirstMock,
  hasCoworkerUserDelegationMock,
} = vi.hoisted(() => ({
  memberFindUniqueMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  orchestratorFindFirstMock: vi.fn(),
  hasCoworkerUserDelegationMock: vi.fn(),
}));

vi.mock("@/middleware/coworker-delegation", () => ({
  hasCoworkerUserDelegation: hasCoworkerUserDelegationMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
    member: {
      findUnique: memberFindUniqueMock,
    },
    orchestrator: {
      findFirst: orchestratorFindFirstMock,
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
  app.use("*", coworkerContextMiddleware);
  app.get("/", (c) => c.json({ authContext: c.var.authContext }));
  return app;
}

describe("coworkerContextMiddleware", () => {
  beforeEach(() => {
    memberFindUniqueMock.mockReset();
    userFindUniqueMock.mockReset();
    orchestratorFindFirstMock.mockReset();
    hasCoworkerUserDelegationMock.mockReset();
    hasCoworkerUserDelegationMock.mockResolvedValue(true);
  });

  it("does not change user authentication context when context headers are present", async () => {
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
        "X-Context-User-Id": "context_user",
        "X-Context-Organization-Id": "context_org",
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

  it("leaves coworker context unchanged when context headers are absent", async () => {
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

  it("attaches context with null organization when only X-Context-User-Id is set", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user_context" });

    const app = createApp({
      isAuthenticated: true,
      authContext: {
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: TEST_VENDOR_ID,
      },
    });

    const res = await app.request("http://localhost/", {
      headers: { "X-Context-User-Id": "  user_context  " },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authContext: AuthVariables["authContext"];
    };
    expect(body.authContext).toEqual({
      actor: "coworker",
      coworkerId: "cow_1",
      vendorId: TEST_VENDOR_ID,
      isDelegationApproved: true,
      context: { userId: "user_context", organizationId: null },
    });
  });

  it("marks the context unapproved when the coworker has no delegation", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user_victim" });
    hasCoworkerUserDelegationMock.mockResolvedValue(false);

    const app = createApp({
      isAuthenticated: true,
      authContext: {
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: TEST_VENDOR_ID,
      },
    });

    const res = await app.request("http://localhost/", {
      headers: { "X-Context-User-Id": "user_victim" },
    });

    // The context is attached but flagged: it reaches ONLY delegated task
    // create (which parks and asks a human), and requireUserContext rejects it
    // everywhere else. Existence of the user is never authorization.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authContext: AuthVariables["authContext"];
    };
    expect(body.authContext).toMatchObject({
      actor: "coworker",
      isDelegationApproved: false,
      context: { userId: "user_victim" },
    });
    expect(hasCoworkerUserDelegationMock).toHaveBeenCalledWith({
      coworkerId: "cow_1",
      vendorId: TEST_VENDOR_ID,
      userId: "user_victim",
    });
  });

  it("does not require delegation for the first-party orchestrator token", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user_context" });
    orchestratorFindFirstMock.mockResolvedValue({ id: "orc_1" });
    hasCoworkerUserDelegationMock.mockResolvedValue(false);

    const app = createApp({
      isAuthenticated: true,
      authContext: { actor: "orchestrator" },
    });

    const res = await app.request("http://localhost/", {
      headers: { "X-Context-User-Id": "user_context" },
    });

    expect(res.status).toBe(200);
    expect(hasCoworkerUserDelegationMock).not.toHaveBeenCalled();
  });

  it("accepts legacy X-Delegation-User-Id when context headers are absent", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user_legacy" });

    const app = createApp({
      isAuthenticated: true,
      authContext: {
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: TEST_VENDOR_ID,
      },
    });

    const res = await app.request("http://localhost/", {
      headers: { "X-Delegation-User-Id": "user_legacy" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authContext: AuthVariables["authContext"];
    };
    expect(body.authContext).toEqual({
      actor: "coworker",
      coworkerId: "cow_1",
      vendorId: TEST_VENDOR_ID,
      isDelegationApproved: true,
      context: { userId: "user_legacy", organizationId: null },
    });
  });

  it("prefers X-Context-* over legacy X-Delegation-* when both are sent", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "context_wins" });

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
        "X-Context-User-Id": "context_wins",
        "X-Delegation-User-Id": "legacy_loses",
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
      isDelegationApproved: true,
      context: { userId: "context_wins", organizationId: null },
    });
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "context_wins" },
      select: { id: true },
    });
  });

  it("attaches context with organization when both context headers are set and user is a member", async () => {
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
        "X-Context-User-Id": "u1",
        "X-Context-Organization-Id": "  org_1  ",
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
      isDelegationApproved: true,
      context: { userId: "u1", organizationId: "org_1" },
    });
  });

  it("returns 400 when context user is not a member of the organization", async () => {
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
        "X-Context-User-Id": "u1",
        "X-Context-Organization-Id": "org_1",
      },
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when context user does not exist", async () => {
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
      headers: { "X-Context-User-Id": "missing_user" },
    });

    expect(res.status).toBe(400);
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 400 when organization context header is set without user id", async () => {
    const app = createApp({
      isAuthenticated: true,
      authContext: {
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: TEST_VENDOR_ID,
      },
    });

    const res = await app.request("http://localhost/", {
      headers: { "X-Context-Organization-Id": "org_only" },
    });

    expect(res.status).toBe(400);
  });

  it("binds active orchestratorId for orchestrator actor with X-Context-User-Id", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user_context" });
    orchestratorFindFirstMock.mockResolvedValue({
      id: "01960001-0001-7001-8001-000000000099",
    });

    const app = createApp({
      isAuthenticated: true,
      authContext: { actor: "orchestrator" },
    });

    const res = await app.request("http://localhost/", {
      headers: { "X-Context-User-Id": "user_context" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authContext: AuthVariables["authContext"];
    };
    expect(body.authContext).toEqual({
      actor: "orchestrator",
      orchestratorId: "01960001-0001-7001-8001-000000000099",
      context: { userId: "user_context", organizationId: null },
    });
    expect(orchestratorFindFirstMock).toHaveBeenCalledWith({
      where: { userId: "user_context", archivedAt: null },
      select: { id: true },
    });
  });

  it("leaves orchestratorId unset when context user has no active instance", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user_context" });
    orchestratorFindFirstMock.mockResolvedValue(null);

    const app = createApp({
      isAuthenticated: true,
      authContext: { actor: "orchestrator" },
    });

    const res = await app.request("http://localhost/", {
      headers: { "X-Context-User-Id": "user_context" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authContext: AuthVariables["authContext"];
    };
    expect(body.authContext).toEqual({
      actor: "orchestrator",
      orchestratorId: undefined,
      context: { userId: "user_context", organizationId: null },
    });
  });
});
