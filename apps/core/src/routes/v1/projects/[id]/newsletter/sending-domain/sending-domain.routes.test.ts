import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

import mountCheck from "./check/post";
import mountCloudflare from "./cloudflare/post";
import mountDelete from "./delete";
import mountDomainConnect from "./domain-connect/get";
import mountGet from "./get";
import mountPut from "./put";

const WORKSPACE_ID = "019a0000-0000-7000-8000-000000000001";
const PROJECT_ID = "019a0000-0000-7000-8000-000000000003";
const DOMAIN_PATH = `/${PROJECT_ID}/newsletter/sending-domain`;
const TOKEN = "cf-secret-token-0123456789abcdef";
const NOW = "2026-10-27T12:00:00.000Z";
const DOMAIN = {
  id: "019a0000-0000-7000-8000-000000000002",
  domain: "brand.example",
  fromAddress: "news@brand.example",
  status: "PENDING",
  dnsRecords: [],
  lastCheckedAt: null,
  failureReason: null,
  createdAt: new Date(NOW),
};

const m = vi.hoisted(() => ({
  authorize: vi.fn(),
  workspace: vi.fn(),
  project: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  check: vi.fn(),
  remove: vi.fn(),
  cloudflare: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findUnique: m.workspace },
    project: { findFirst: m.project },
  },
}));
vi.mock("@/helpers/coworker-user-context-binding", () => ({
  requireAuthorizedUserContext: m.authorize,
}));
vi.mock("@/services/newsletter-sending-domain.service", async (original) => ({
  ...(await original<
    typeof import("@/services/newsletter-sending-domain.service")
  >()),
  getNewsletterSendingDomain: m.get,
  putNewsletterSendingDomain: m.put,
  checkNewsletterSendingDomain: m.check,
  removeNewsletterSendingDomain: m.remove,
  connectNewsletterSendingDomainWithCloudflare: m.cloudflare,
  getNewsletterSendingDomainConnect: m.connect,
}));

const USER: AuthenticationContext = {
  actor: "user",
  userId: "user_1",
  organizationId: "org_1",
  role: "user",
  authenticationMethod: "session",
};
const COWORKER = {
  actor: "coworker",
  coworkerId: "coworker_1",
  vendorId: "vendor_1",
  context: { userId: "user_1", organizationId: "org_1" },
} satisfies AuthenticationContext;
const SOKO_BOT = {
  actor: "sokoBot",
  sokoBotId: "bot_1",
  userId: "user_1",
  organizationId: "org_1",
  workspaceId: WORKSPACE_ID,
  scope: "personal",
} satisfies AuthenticationContext;
const WORKSPACE: WorkspaceContext = {
  workspaceId: WORKSPACE_ID,
  userId: null,
  organizationId: "org_1",
};

function createApp(auth: AuthenticationContext = USER) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("requestId", "sending_domain_test");
    c.set("authContext", auth);
    c.set("workspaceContext", WORKSPACE);
    await next();
  });
  for (const mount of [
    mountGet,
    mountPut,
    mountDelete,
    mountCheck,
    mountCloudflare,
    mountDomainConnect,
  ]) {
    mount(app);
  }
  app.onError(errorHandler);
  return app;
}

const MUTATIONS = [
  ["PUT", DOMAIN_PATH, { fromAddress: "news@brand.example" }],
  ["DELETE", DOMAIN_PATH, undefined],
  ["POST", `${DOMAIN_PATH}/check`, undefined],
  ["POST", `${DOMAIN_PATH}/cloudflare`, { apiToken: TOKEN }],
  ["GET", `${DOMAIN_PATH}/domain-connect`, undefined],
] as const;

function send(
  app: ReturnType<typeof createApp>,
  [method, path, body]: readonly [string, string, object | undefined],
) {
  return app.request(path, {
    method,
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }
      : {}),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.authorize.mockResolvedValue({ userId: "user_1", organizationId: "org_1" });
  m.workspace.mockResolvedValue({ organization: { slug: "utxo" } });
  m.project.mockResolvedValue({ id: PROJECT_ID });
  m.get.mockResolvedValue(DOMAIN);
  m.put.mockResolvedValue(DOMAIN);
  m.check.mockResolvedValue(DOMAIN);
  m.cloudflare.mockResolvedValue(DOMAIN);
  m.connect.mockResolvedValue(null);
});

describe("GET /v1/projects/{id}/newsletter/sending-domain", () => {
  it("shows a project member the domain and that they may manage it", async () => {
    const response = await createApp().request(DOMAIN_PATH);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        sendingDomain: { domain: "brand.example", status: "PENDING" },
        canManage: true,
        fallbackAvailable: true,
      },
    });
  });

  it("lets an authorized agent read it without managing", async () => {
    const response = await createApp(COWORKER).request(DOMAIN_PATH);
    expect(response.status).toBe(200);
    expect((await response.json()).data.canManage).toBe(false);
  });

  it("looks up only the requested project in the active workspace", async () => {
    const otherProjectId = "019a0000-0000-7000-8000-000000000004";
    const response = await createApp().request(
      `/${otherProjectId}/newsletter/sending-domain`,
    );
    expect(response.status).toBe(200);
    expect(m.project).toHaveBeenCalledWith({
      where: { id: otherProjectId, workspaceId: WORKSPACE_ID },
      select: expect.any(Object),
    });
    expect(m.get).toHaveBeenCalledWith(otherProjectId);
    expect(m.authorize).toHaveBeenCalledWith(USER);
  });

  it("404s for a project outside the active workspace before reading its domain", async () => {
    m.project.mockResolvedValue(null);
    const response = await createApp().request(DOMAIN_PATH);
    expect(response.status).toBe(404);
    expect(m.get).not.toHaveBeenCalled();
  });

  it("rejects an actor without project newsletter authorization before reading", async () => {
    m.authorize.mockRejectedValue(forbidden("Workspace access denied"));
    const response = await createApp(COWORKER).request(DOMAIN_PATH);
    expect(response.status).toBe(403);
    expect(m.project).not.toHaveBeenCalled();
    expect(m.get).not.toHaveBeenCalled();
  });

  it("404s outside the newsletter beta", async () => {
    m.workspace.mockResolvedValue({ organization: { slug: "other" } });
    expect((await createApp().request(DOMAIN_PATH)).status).toBe(404);
  });
});

describe("sending domain mutations", () => {
  it("allows a plain project member to connect, remove, check and configure DNS", async () => {
    for (const mutation of MUTATIONS) {
      const response = await send(createApp(), mutation);
      expect(response.status, mutation.join(" ")).toBeLessThan(300);
    }
    expect(m.put).toHaveBeenCalledWith(PROJECT_ID, "news@brand.example");
    expect(m.cloudflare).toHaveBeenCalledWith(PROJECT_ID, TOKEN);
    expect(m.remove).toHaveBeenCalledWith(PROJECT_ID);
    expect(m.check).toHaveBeenCalledWith(PROJECT_ID);
    expect(m.connect).toHaveBeenCalledWith(PROJECT_ID);
  });

  it.each(MUTATIONS)(
    "%s %s rejects an inaccessible project",
    async (...mutation) => {
      m.project.mockResolvedValue(null);
      const response = await send(createApp(), mutation);
      expect(response.status).toBe(404);
      expect(m.put).not.toHaveBeenCalled();
      expect(m.check).not.toHaveBeenCalled();
      expect(m.cloudflare).not.toHaveBeenCalled();
      expect(m.connect).not.toHaveBeenCalled();
      expect(m.remove).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["coworker", COWORKER],
    ["Soko Bot", SOKO_BOT],
  ])("are forbidden for a %s", async (_, auth) => {
    for (const mutation of MUTATIONS) {
      const response = await send(createApp(auth), mutation);
      expect(response.status, mutation.join(" ")).toBe(403);
    }
    expect(m.project).not.toHaveBeenCalled();
    expect(m.authorize).not.toHaveBeenCalled();
    expect(m.put).not.toHaveBeenCalled();
    expect(m.cloudflare).not.toHaveBeenCalled();
    expect(m.remove).not.toHaveBeenCalled();
  });

  it("rejects an invalid From address before calling the service", async () => {
    const response = await send(createApp(), [
      "PUT",
      DOMAIN_PATH,
      { fromAddress: "Brand <news@brand.example>" },
    ]);
    expect(response.status).toBe(422);
    expect(m.put).not.toHaveBeenCalled();
  });

  it("never echoes the Cloudflare token in a validation error", async () => {
    const response = await send(createApp(), [
      "POST",
      `${DOMAIN_PATH}/cloudflare`,
      { apiToken: "short-token" },
    ]);
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain("short-token");
  });
});

describe("sending domain API contract", () => {
  it.each([["GET", DOMAIN_PATH, undefined], ...MUTATIONS] as const)(
    "%s %s rejects an invalid project id before accessing data",
    async (method, path, body) => {
      const response = await send(createApp(), [
        method,
        path.replace(PROJECT_ID, "invalid-project"),
        body,
      ]);
      expect(response.status).toBe(422);
      expect(m.project).not.toHaveBeenCalled();
      expect(m.get).not.toHaveBeenCalled();
      expect(m.put).not.toHaveBeenCalled();
      expect(m.check).not.toHaveBeenCalled();
      expect(m.cloudflare).not.toHaveBeenCalled();
      expect(m.connect).not.toHaveBeenCalled();
      expect(m.remove).not.toHaveBeenCalled();
    },
  );

  it("exposes only project-scoped operations", () => {
    const document = createApp().getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "test", version: "1" },
    });
    expect(Object.keys(document.paths ?? {})).toEqual([
      "/{id}/newsletter/sending-domain",
      "/{id}/newsletter/sending-domain/check",
      "/{id}/newsletter/sending-domain/cloudflare",
      "/{id}/newsletter/sending-domain/domain-connect",
    ]);
  });
});
