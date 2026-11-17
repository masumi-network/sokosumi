import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvConfig } from "@/config/env";
import { serviceUnavailable } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

const mocks = vi.hoisted(() => ({
  auth: {
    current: {
      actor: "user",
      userId: "admin-a",
      organizationId: null,
      role: "admin",
    } as AuthenticationContext,
  },
  getAdminAdEvalsDashboard: vi.fn(),
  exportAdminAdEvals: vi.fn(),
  auditAdEvalsExport: vi.fn(),
  auditAdEvalsExportFailure: vi.fn(),
  findMember: vi.fn(),
  findActiveOrganizationMember: vi.fn(),
  env: {} as Pick<
    EnvConfig,
    "AD_EVALS_ADMIN_ORGANIZATION_SLUG" | "AD_EVALS_ADMIN_ORGANIZATION_ID"
  >,
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), ...mocks.env }),
  };
});
vi.mock("@/lib/db/prisma", () => ({
  default: {
    member: {
      findFirst: mocks.findMember,
      findUnique: mocks.findActiveOrganizationMember,
    },
  },
}));
vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: async (
    c: { set: (key: string, value: unknown) => void },
    next: () => Promise<unknown>,
  ) => {
    c.set("isAuthenticated", true);
    c.set("authContext", mocks.auth.current);
    c.set("requestId", "request-a");
    return next();
  },
}));
vi.mock("@/services/ad-evals.service", () => ({
  getAdminAdEvalsDashboard: mocks.getAdminAdEvalsDashboard,
}));
vi.mock("@/services/ad-evals-export.service", () => ({
  exportAdminAdEvals: mocks.exportAdminAdEvals,
}));
vi.mock("@/lib/ad-evals-audit", () => ({
  auditAdEvalsExport: mocks.auditAdEvalsExport,
  auditAdEvalsExportFailure: mocks.auditAdEvalsExportFailure,
}));

const { default: router } = await import("./index");

function app(withParentAdminGate = true) {
  const instance = new OpenAPIHonoWithAuth();
  if (withParentAdminGate) {
    instance.use(
      "*",
      createMiddleware(async (c, next) => {
        requireAdminAuthContext(c.var.authContext);
        await next();
      }),
    );
  }
  instance.onError(errorHandler);
  instance.route("/admin/ad-evals", router);
  return instance;
}

const manifest = {
  exportId: "export-a",
  formatVersion: "1",
  policyVersion: "2026-11-13",
  createdAt: "2026-11-13T10:00:00.000Z",
  workspaceHashes: ["hashed-workspace"],
  rowCount: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.current = {
    actor: "user",
    userId: "admin-a",
    organizationId: null,
    role: "admin",
  };
  mocks.env = {
    AD_EVALS_ADMIN_ORGANIZATION_SLUG: "internal-workspace",
    AD_EVALS_ADMIN_ORGANIZATION_ID: undefined,
  };
  mocks.findMember.mockResolvedValue({ id: "member-a" });
  mocks.findActiveOrganizationMember.mockResolvedValue({
    id: "active-member-a",
  });
  mocks.getAdminAdEvalsDashboard.mockResolvedValue({
    leaderboard: [],
    agreement: [],
    minimumWorkspaces: 5,
  });
  mocks.exportAdminAdEvals.mockResolvedValue({
    jsonl: '{"type":"rating"}\n',
    manifest,
  });
});

describe("admin ad-evals routes", () => {
  it("returns an empty dashboard in the standard Core envelope", async () => {
    const response = await app().request("/admin/ad-evals");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { leaderboard: [], agreement: [], minimumWorkspaces: 5 },
      meta: { requestId: "request-a" },
    });
  });

  it("checks access without loading the dashboard or export", async () => {
    const response = await app().request("/admin/ad-evals/access");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { hasAccess: true },
      meta: { requestId: "request-a" },
    });
    expect(mocks.getAdminAdEvalsDashboard).not.toHaveBeenCalled();
    expect(mocks.exportAdminAdEvals).not.toHaveBeenCalled();
  });

  it("allows members even while another workspace is active", async () => {
    mocks.auth.current = {
      actor: "user",
      userId: "admin-a",
      organizationId: "other-workspace",
      role: "admin",
    };

    expect((await app().request("/admin/ad-evals")).status).toBe(200);
    expect(mocks.findActiveOrganizationMember).toHaveBeenCalledWith({
      where: {
        userId_organizationId: {
          userId: "admin-a",
          organizationId: "other-workspace",
        },
      },
      select: { id: true },
    });
    expect(mocks.findMember).toHaveBeenCalledWith({
      where: {
        userId: "admin-a",
        organization: { slug: "internal-workspace" },
      },
      select: { id: true },
    });
  });

  it.each([true, false])(
    "denies ordinary users with parent admin gate=%s",
    async (withParentAdminGate) => {
      mocks.auth.current = {
        actor: "user",
        userId: "member-a",
        organizationId: null,
        role: "user",
      };
      for (const path of [
        "/admin/ad-evals",
        "/admin/ad-evals/export",
        "/admin/ad-evals/access",
      ]) {
        expect((await app(withParentAdminGate).request(path)).status).toBe(403);
      }
      expect(mocks.getAdminAdEvalsDashboard).not.toHaveBeenCalled();
      expect(mocks.exportAdminAdEvals).not.toHaveBeenCalled();
      expect(mocks.findMember).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "denies non-member admins with parent admin gate=%s",
    async (withParentAdminGate) => {
      mocks.findMember.mockResolvedValue(null);

      for (const path of [
        "/admin/ad-evals",
        "/admin/ad-evals/export",
        "/admin/ad-evals/access",
      ]) {
        expect((await app(withParentAdminGate).request(path)).status).toBe(403);
      }
      expect(mocks.getAdminAdEvalsDashboard).not.toHaveBeenCalled();
      expect(mocks.exportAdminAdEvals).not.toHaveBeenCalled();
    },
  );

  it("denies admins when the organization is not configured", async () => {
    mocks.env = {
      AD_EVALS_ADMIN_ORGANIZATION_SLUG: undefined,
      AD_EVALS_ADMIN_ORGANIZATION_ID: undefined,
    };

    for (const path of [
      "/admin/ad-evals",
      "/admin/ad-evals/export",
      "/admin/ad-evals/access",
    ]) {
      expect((await app().request(path)).status).toBe(403);
    }
    expect(mocks.findMember).not.toHaveBeenCalled();
    expect(mocks.getAdminAdEvalsDashboard).not.toHaveBeenCalled();
    expect(mocks.exportAdminAdEvals).not.toHaveBeenCalled();
  });

  it("denies coworker credentials", async () => {
    mocks.auth.current = {
      actor: "coworker",
      coworkerId: "coworker-a",
      vendorId: "vendor-a",
    };
    expect((await app().request("/admin/ad-evals/export")).status).toBe(403);
    expect(mocks.exportAdminAdEvals).not.toHaveBeenCalled();
  });

  it("downloads JSONL privately and audits its versioned workspace manifest", async () => {
    const response = await app().request("/admin/ad-evals/export");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/x-ndjson; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="ad-evals-export-a.jsonl"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe('{"type":"rating"}\n');
    expect(mocks.auditAdEvalsExport).toHaveBeenCalledWith("admin-a", manifest);
    expect(mocks.auditAdEvalsExportFailure).not.toHaveBeenCalled();
  });

  it("audits an export failure and preserves the Core error envelope", async () => {
    mocks.exportAdminAdEvals.mockRejectedValueOnce(
      serviceUnavailable("Image storage unavailable"),
    );
    const response = await app().request("/admin/ad-evals/export");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      message: "Image storage unavailable",
    });
    expect(mocks.auditAdEvalsExportFailure).toHaveBeenCalledWith(
      "admin-a",
      "request-a",
    );
    expect(mocks.auditAdEvalsExport).not.toHaveBeenCalled();
  });

  it("documents the generated client contracts and raw NDJSON content type", () => {
    const document = app().getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "Test", version: "1" },
    });
    expect(document.paths?.["/admin/ad-evals"]?.get?.operationId).toBe(
      "getAdminAdEvals",
    );
    expect(document.paths?.["/admin/ad-evals/access"]?.get?.operationId).toBe(
      "getAdminAdEvalsAccess",
    );
    expect(document.paths?.["/admin/ad-evals/export"]?.get?.operationId).toBe(
      "getAdminAdEvalsExport",
    );
    expect(
      document.paths?.["/admin/ad-evals/export"]?.get?.responses?.["200"],
    ).toMatchObject({
      content: { "application/x-ndjson": { schema: { type: "string" } } },
    });
  });
});
