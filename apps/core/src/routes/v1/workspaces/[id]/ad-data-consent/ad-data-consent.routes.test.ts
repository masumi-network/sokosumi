import { MemberRole } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { WORKSPACE_AD_DATA_POLICY_VERSION } from "@/schemas/workspace-ad-data-consent.schema";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor";

const {
  workspaceFindUniqueMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  consentFindUniqueMock,
  consentUpsertMock,
} = vi.hoisted(() => ({
  workspaceFindUniqueMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  consentFindUniqueMock: vi.fn(),
  consentUpsertMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findUnique: workspaceFindUniqueMock },
    organization: { findUnique: organizationFindUniqueMock },
    member: { findUnique: memberFindUniqueMock },
    workspaceAdDataConsent: {
      findUnique: consentFindUniqueMock,
      upsert: consentUpsertMock,
    },
  },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const NOW = new Date("2026-11-13T12:00:00.000Z");
const USER_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};
const COWORKER_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_1",
  vendorId: TEST_VENDOR_ID,
  context: { userId: "user_123", organizationId: null },
};
const CONSENT = {
  workspaceId: WORKSPACE_ID,
  shareForImprovement: true,
  allowTraining: true,
  decidedByUserId: "user_123",
  decidedAt: NOW,
  policyVersion: WORKSPACE_AD_DATA_POLICY_VERSION,
};

let mountGet: (app: OpenAPIHonoWithAuth) => void;
let mountPut: (app: OpenAPIHonoWithAuth) => void;

function requestConsent(
  method: "GET" | "PUT",
  body?: object,
  authContext: AuthenticationContext | null = USER_CONTEXT,
) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    if (!authContext) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    c.set("requestId", "req_ad_consent");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  mountGet(app);
  mountPut(app);
  return app.request(`http://localhost/${WORKSPACE_ID}/ad-data-consent`, {
    method,
    ...(body && method === "PUT"
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
}

beforeAll(async () => {
  mountGet = (await import("./get")).default;
  mountPut = (await import("./put")).default;
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  workspaceFindUniqueMock.mockResolvedValue({
    userId: null,
    organizationId: "org_1",
  });
  organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.ADMIN });
  consentFindUniqueMock.mockResolvedValue(null);
  consentUpsertMock.mockResolvedValue(CONSENT);
});

afterEach(() => vi.useRealTimers());

describe("workspace ad data consent access", () => {
  it.each(["GET", "PUT"] as const)(
    "rejects unauthenticated %s",
    async (method) => {
      const response = await requestConsent(
        method,
        { shareForImprovement: true, allowTraining: true },
        null,
      );
      expect(response.status).toBe(401);
      expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
    },
  );

  it.each(["GET", "PUT"] as const)(
    "rejects contextual coworkers on %s",
    async (method) => {
      const response = await requestConsent(
        method,
        { shareForImprovement: true, allowTraining: true },
        COWORKER_CONTEXT,
      );
      expect(response.status).toBe(403);
      expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
    },
  );

  it.each(["GET", "PUT"] as const)(
    "rejects another user's personal workspace on %s",
    async (method) => {
      workspaceFindUniqueMock.mockResolvedValue({
        userId: "other_user",
        organizationId: null,
      });
      const response = await requestConsent(method, {
        shareForImprovement: true,
        allowTraining: true,
      });
      expect(response.status).toBe(403);
      expect(consentFindUniqueMock).not.toHaveBeenCalled();
      expect(consentUpsertMock).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for a missing workspace", async () => {
    workspaceFindUniqueMock.mockResolvedValue(null);
    expect((await requestConsent("GET")).status).toBe(404);
    expect(consentFindUniqueMock).not.toHaveBeenCalled();
  });

  it("rejects non-members before reading consent", async () => {
    memberFindUniqueMock.mockResolvedValue(null);
    expect((await requestConsent("GET")).status).toBe(403);
    expect(consentFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("GET /workspaces/{id}/ad-data-consent", () => {
  it("defaults both choices off without creating a decision", async () => {
    const response = await requestConsent("GET");
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      workspaceId: WORKSPACE_ID,
      shareForImprovement: false,
      allowTraining: false,
      decidedAt: null,
      policyVersion: WORKSPACE_AD_DATA_POLICY_VERSION,
    });
    expect(consentFindUniqueMock).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID },
    });
    expect(consentUpsertMock).not.toHaveBeenCalled();
  });

  it("lets a workspace member read choices without exposing the deciding user", async () => {
    memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
    consentFindUniqueMock.mockResolvedValue(CONSENT);
    const response = await requestConsent("GET");
    expect(response.status).toBe(200);
    const { decidedByUserId: _decidedByUserId, ...expected } = CONSENT;
    expect((await response.json()).data).toEqual({
      ...expected,
      decidedAt: NOW.toISOString(),
    });
  });
});

describe("PUT /workspaces/{id}/ad-data-consent", () => {
  it.each([MemberRole.OWNER, MemberRole.ADMIN])(
    "lets a workspace %s upsert the real user's dated decision",
    async (role) => {
      memberFindUniqueMock.mockResolvedValue({ role });
      const response = await requestConsent("PUT", {
        shareForImprovement: true,
        allowTraining: true,
        decidedByUserId: "spoofed_user",
        policyVersion: "spoofed_policy",
      });
      expect(response.status).toBe(200);
      expect(consentUpsertMock).toHaveBeenCalledWith({
        where: { workspaceId: WORKSPACE_ID },
        create: CONSENT,
        update: {
          shareForImprovement: true,
          allowTraining: true,
          decidedByUserId: USER_CONTEXT.userId,
          decidedAt: NOW,
          policyVersion: WORKSPACE_AD_DATA_POLICY_VERSION,
        },
      });
      expect((await response.json()).data).not.toHaveProperty(
        "decidedByUserId",
      );
    },
  );

  it("lets a personal workspace owner decide", async () => {
    workspaceFindUniqueMock.mockResolvedValue({
      userId: USER_CONTEXT.userId,
      organizationId: null,
    });
    expect(
      (
        await requestConsent("PUT", {
          shareForImprovement: true,
          allowTraining: true,
        })
      ).status,
    ).toBe(200);
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
    expect(consentUpsertMock).toHaveBeenCalled();
  });

  it("rejects regular workspace members", async () => {
    memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
    expect(
      (
        await requestConsent("PUT", {
          shareForImprovement: true,
          allowTraining: true,
        })
      ).status,
    ).toBe(403);
    expect(consentUpsertMock).not.toHaveBeenCalled();
  });

  it("requires sharing for improvement before allowing training", async () => {
    const response = await requestConsent("PUT", {
      shareForImprovement: false,
      allowTraining: true,
    });
    expect(response.status).toBe(422);
    expect(consentUpsertMock).not.toHaveBeenCalled();
  });

  it("revokes both choices in the same write", async () => {
    consentUpsertMock.mockResolvedValue({
      ...CONSENT,
      shareForImprovement: false,
      allowTraining: false,
    });
    const response = await requestConsent("PUT", {
      shareForImprovement: false,
      allowTraining: false,
    });
    expect(response.status).toBe(200);
    expect(consentUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          shareForImprovement: false,
          allowTraining: false,
        }),
      }),
    );
  });

  it("requires both explicit boolean choices", async () => {
    expect(
      (await requestConsent("PUT", { shareForImprovement: "true" })).status,
    ).toBe(422);
    expect(consentUpsertMock).not.toHaveBeenCalled();
  });
});
