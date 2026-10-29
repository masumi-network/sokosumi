import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import mountResume from "./warmup/resume/post";

const WORKSPACE_ID = "019a0000-0000-7000-8000-000000000001";
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
  warmup: {
    startedAt: null,
    day: null,
    dailyCap: null,
    sentToday: 0,
    pausedAt: null,
    pauseReason: null,
  },
};

const m = vi.hoisted(() => ({
  workspace: vi.fn(),
  member: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  check: vi.fn(),
  remove: vi.fn(),
  cloudflare: vi.fn(),
  connect: vi.fn(),
  resume: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findUnique: m.workspace },
    member: { findFirst: m.member },
  },
}));
vi.mock("@/helpers/coworker-user-context-binding", () => ({
  requireAuthorizedUserContext: async () => ({
    userId: "user_1",
    organizationId: "org_1",
  }),
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
  resumeNewsletterSendingDomainWarmup: m.resume,
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
} as AuthenticationContext;
const SOKO_BOT = {
  actor: "sokoBot",
  sokoBotId: "bot_1",
  userId: "user_1",
  organizationId: "org_1",
  workspaceId: WORKSPACE_ID,
} as AuthenticationContext;
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
    mountResume,
  ]) {
    mount(app);
  }
  app.onError(errorHandler);
  return app;
}

const MUTATIONS = [
  ["PUT", "/sending-domain", { fromAddress: "news@brand.example" }],
  ["DELETE", "/sending-domain", undefined],
  ["POST", "/sending-domain/check", undefined],
  ["POST", "/sending-domain/warmup/resume", undefined],
  ["POST", "/sending-domain/cloudflare", { apiToken: TOKEN }],
  ["GET", "/sending-domain/domain-connect", undefined],
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
  m.workspace.mockResolvedValue({ organization: { slug: "utxo" } });
  m.member.mockResolvedValue({ role: "admin" });
  m.get.mockResolvedValue(DOMAIN);
  m.put.mockResolvedValue(DOMAIN);
  m.check.mockResolvedValue(DOMAIN);
  m.resume.mockResolvedValue(DOMAIN);
  m.cloudflare.mockResolvedValue(DOMAIN);
  m.connect.mockResolvedValue(null);
});

describe("GET /v1/newsletter/sending-domain", () => {
  it("shows an admin the domain and that they may manage it", async () => {
    const response = await createApp().request("/sending-domain");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        sendingDomain: { domain: "brand.example", status: "PENDING" },
        canManage: true,
        fallbackAvailable: true,
      },
    });
  });

  it("lets a member or an agent read it without managing", async () => {
    m.member.mockResolvedValue({ role: "member" });
    let response = await createApp().request("/sending-domain");
    expect((await response.json()).data.canManage).toBe(false);

    response = await createApp(COWORKER).request("/sending-domain");
    expect(response.status).toBe(200);
    expect((await response.json()).data.canManage).toBe(false);
  });

  it("404s outside the newsletter beta", async () => {
    m.workspace.mockResolvedValue({ organization: { slug: "other" } });
    expect((await createApp().request("/sending-domain")).status).toBe(404);
  });
});

describe("sending domain mutations", () => {
  it.each(["owner", "admin"])(
    "are allowed for an organization %s",
    async (role) => {
      m.member.mockResolvedValue({ role });
      for (const mutation of MUTATIONS) {
        const response = await send(createApp(), mutation);
        expect(response.status, mutation.join(" ")).toBeLessThan(300);
      }
      expect(m.put).toHaveBeenCalledWith(WORKSPACE_ID, "news@brand.example");
      expect(m.cloudflare).toHaveBeenCalledWith(WORKSPACE_ID, TOKEN);
      expect(m.remove).toHaveBeenCalledWith(WORKSPACE_ID);
      expect(m.resume).toHaveBeenCalledWith(WORKSPACE_ID);
    },
  );

  it.each(MUTATIONS)(
    "%s %s is forbidden for a plain member",
    async (...mutation) => {
      m.member.mockResolvedValue({ role: "member" });
      const response = await send(createApp(), mutation);
      expect(response.status).toBe(403);
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
    expect(m.member).not.toHaveBeenCalled();
    expect(m.put).not.toHaveBeenCalled();
    expect(m.cloudflare).not.toHaveBeenCalled();
    expect(m.remove).not.toHaveBeenCalled();
  });

  it("rejects an invalid From address before calling the service", async () => {
    const response = await send(createApp(), [
      "PUT",
      "/sending-domain",
      { fromAddress: "Brand <news@brand.example>" },
    ]);
    expect(response.status).toBe(422);
    expect(m.put).not.toHaveBeenCalled();
  });

  it("never echoes the Cloudflare token in a validation error", async () => {
    const response = await send(createApp(), [
      "POST",
      "/sending-domain/cloudflare",
      { apiToken: "short-token" },
    ]);
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain("short-token");
  });
});

it("returns warm-up status for ordinary members", async () => {
  m.member.mockResolvedValue({ role: "member" });
  m.get.mockResolvedValue({
    ...DOMAIN,
    status: "VERIFIED",
    warmup: {
      startedAt: new Date(NOW),
      day: 0,
      dailyCap: 50,
      sentToday: 17,
      pausedAt: new Date(NOW),
      pauseReason: "BOUNCE_RATE",
    },
  });
  const response = await createApp().request("/sending-domain");
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({
    canManage: false,
    sendingDomain: {
      warmup: {
        day: 0,
        dailyCap: 50,
        sentToday: 17,
        pausedAt: NOW,
        pauseReason: "BOUNCE_RATE",
      },
    },
  });
});
