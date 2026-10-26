import { OpenAPIHono } from "@hono/zod-openapi";
import { MockLanguageModelV3 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import {
  NEWSLETTER,
  NEWSLETTER_ISSUE,
  NEWSLETTER_PROJECT_ID,
  NEWSLETTER_WORKSPACE_ID,
} from "@/test/newsletter";
import mount from "./post";

const m = vi.hoisted(() => ({
  enabled: true,
  project: vi.fn(),
  newsletter: vi.fn(),
  availableNewsletter: vi.fn(),
  posts: vi.fn(),
  assets: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  send: vi.fn(),
  credits: vi.fn(),
  eval: vi.fn(),
  generate: vi.fn(),
  copy: vi.fn(),
  head: vi.fn(),
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), NEWSLETTER_ENABLED: m.enabled }),
  };
});
vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findFirst: m.project },
    newsletter: {
      findUnique: m.newsletter,
      findFirst: m.availableNewsletter,
    },
    socialPost: { findMany: m.posts },
    projectImageAsset: { findMany: m.assets },
    newsletterIssue: { create: m.create, updateMany: m.update },
    newsletterSend: { createMany: m.send },
    creditConsumption: { create: m.credits },
  },
}));
vi.mock("@/lib/redis", () => ({ getRedisClient: () => ({ eval: m.eval }) }));
vi.mock("@/services/image-studio-drive.service", () => ({
  ensureStudioAssetDriveFile: m.copy,
}));
vi.mock("@vercel/blob", () => ({ head: m.head }));

const INPUT = { brief: "Share the launch news" };
const DRAFT = {
  subject: "Launch news",
  previewText: "What is new",
  content: [{ type: "text", text: "The launch is here." }],
};
const IMAGE_ID = "66666666-6666-4666-8666-666666666666";
const IMAGE_URL = "https://example.com/studio.png";
const model = new MockLanguageModelV3({ doGenerate: m.generate });
function output(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: {
        total: 20,
        noCache: 20,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: 30, text: 30, reasoning: undefined },
    },
    warnings: [],
  };
}
function app(authenticated = true) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    if (!authenticated) throw unauthorized("Unauthorized");
    c.set("requestId", "newsletter_draft_test");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_1",
      organizationId: null,
      role: "user",
      authenticationMethod: "session",
    });
    c.set("workspaceContext", {
      workspaceId: NEWSLETTER_WORKSPACE_ID,
      userId: "user_1",
      organizationId: null,
    });
    await next();
  });
  mount(app, model);
  app.onError(errorHandler);
  return app;
}
function draft(body: unknown = INPUT, authenticated = true) {
  return app(authenticated).request(
    `/${NEWSLETTER_PROJECT_ID}/newsletter/issues/draft-with-ai`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  m.enabled = true;
  m.project.mockResolvedValue({
    id: NEWSLETTER_PROJECT_ID,
    name: "Launch",
    briefing: "Project briefing",
    contextMd: "Private memory",
    closingAt: null,
    closedAt: null,
  });
  m.newsletter.mockResolvedValue(NEWSLETTER);
  m.availableNewsletter.mockResolvedValue({ id: NEWSLETTER.id });
  m.posts.mockResolvedValue([{ text: "Recent post" }]);
  m.assets.mockResolvedValue([]);
  m.eval.mockResolvedValue(1);
  m.generate.mockResolvedValue(output(DRAFT));
  m.create.mockImplementation(async ({ data }) => ({
    ...NEWSLETTER_ISSUE,
    ...data,
  }));
  m.copy.mockResolvedValue({ pathname: "studio/image.png" });
  m.head.mockResolvedValue({ url: IMAGE_URL });
});

describe("POST newsletter draft-with-ai with an injected fake model", () => {
  it("creates a DRAFT without approvals, scheduling, sends, or credit charges", async () => {
    const response = await draft();
    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({
      ...DRAFT,
      template: "TEXT",
      status: "DRAFT",
      approvedAt: null,
      scheduledAt: null,
      sentAt: null,
    });
    const data = m.create.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("approvedAt");
    expect(data).not.toHaveProperty("scheduledAt");
    expect(m.update).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
    expect(m.credits).not.toHaveBeenCalled();
    expect(m.generate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(m.generate.mock.calls[0])).toContain(
      "Project briefing",
    );
    expect(JSON.stringify(m.generate.mock.calls[0])).not.toContain(
      "Private memory",
    );
    expect(m.project.mock.calls[1]![0].select).not.toHaveProperty("contextMd");
    expect(m.posts).not.toHaveBeenCalled();
    expect(m.assets).not.toHaveBeenCalled();
  });

  it("gathers only scoped selected sources and preserves the chosen template", async () => {
    m.assets.mockResolvedValue([
      { id: IMAGE_ID, prompt: "Launch image", contentType: "image/png" },
    ]);
    m.generate.mockResolvedValue(
      output({
        ...DRAFT,
        content: [{ type: "image", url: IMAGE_URL, alt: "Launch" }],
      }),
    );
    const response = await draft({
      ...INPUT,
      useProjectMemory: true,
      useRecentSocialPosts: true,
      template: "IMAGES",
      imageIds: [IMAGE_ID],
    });
    expect(response.status).toBe(201);
    expect((await response.json()).data.template).toBe("IMAGES");
    const prompt = JSON.stringify(m.generate.mock.calls[0]);
    for (const source of [
      "Private memory",
      "Recent post",
      IMAGE_URL,
      "Launch image",
    ])
      expect(prompt).toContain(source);
    expect(m.posts).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: NEWSLETTER_PROJECT_ID,
          workspaceId: NEWSLETTER_WORKSPACE_ID,
        },
        take: 10,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { text: true },
      }),
    );
    expect(m.assets).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: NEWSLETTER_PROJECT_ID,
          workspaceId: NEWSLETTER_WORKSPACE_ID,
          id: { in: [IMAGE_ID] },
        },
      }),
    );
    expect(m.copy).toHaveBeenCalledWith({
      projectId: NEWSLETTER_PROJECT_ID,
      workspaceId: NEWSLETTER_WORKSPACE_ID,
      userId: "user_1",
      organizationId: null,
      assetId: IMAGE_ID,
    });
  });

  it("does not read unselected memory when only recent Social posts are enabled", async () => {
    expect((await draft({ ...INPUT, useRecentSocialPosts: true })).status).toBe(
      201,
    );
    const prompt = JSON.stringify(m.generate.mock.calls[0]);
    expect(prompt).toContain("Recent post");
    expect(prompt).not.toContain("Private memory");
  });

  it.each([
    { content: [{ type: "html", html: "<script>bad</script>" }] },
    {
      content: [
        { type: "image", url: "http://example.com/a.png", alt: "unsafe" },
      ],
    },
    { content: [{ type: "image", url: IMAGE_URL, alt: "not selected" }] },
    { subject: "" },
    { content: [] },
  ])("repairs invalid structured output once: %j", async (invalid) => {
    m.generate.mockResolvedValueOnce(output({ ...DRAFT, ...invalid }));
    const response = await draft();
    expect(response.status).toBe(201);
    expect((await response.json()).data.subject).toBe(DRAFT.subject);
    expect(m.generate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(m.generate.mock.calls[1])).toContain(
      "Repair the response",
    );
    expect(m.create).toHaveBeenCalledTimes(1);
  });

  it.each(["invalid", "outage"])(
    "falls back to one text block after two failures: %s",
    async (failure) => {
      if (failure === "outage")
        m.generate.mockRejectedValue(new Error("Provider unavailable"));
      else m.generate.mockResolvedValue(output({ content: "bad" }));
      const response = await draft();
      expect(response.status).toBe(201);
      expect((await response.json()).data).toMatchObject({
        subject: INPUT.brief,
        content: [{ type: "text", text: INPUT.brief }],
        status: "DRAFT",
      });
      expect(m.generate).toHaveBeenCalledTimes(2);
    },
  );

  it("requires authentication, enabled newsletters and project access before generation", async () => {
    expect((await draft(INPUT, false)).status).toBe(401);
    m.enabled = false;
    expect((await draft()).status).toBe(404);
    expect(m.project).not.toHaveBeenCalled();
    m.enabled = true;
    m.project.mockResolvedValue(null);
    expect((await draft()).status).toBe(404);
    m.project.mockResolvedValue({ id: NEWSLETTER_PROJECT_ID });
    m.newsletter.mockResolvedValue(null);
    expect((await draft()).status).toBe(404);
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.eval).not.toHaveBeenCalled();
  });

  it("rejects cross-project image ids before copying bytes or calling the model", async () => {
    expect((await draft({ ...INPUT, imageIds: [IMAGE_ID] })).status).toBe(422);
    expect(m.copy).not.toHaveBeenCalled();
    expect(m.generate).not.toHaveBeenCalled();
  });

  it("rejects personal and non-beta workspaces before reading draft sources", async () => {
    m.availableNewsletter.mockResolvedValue(null);
    const response = await draft({
      ...INPUT,
      useProjectMemory: true,
      useRecentSocialPosts: true,
      imageIds: [IMAGE_ID],
    });
    expect(response.status).toBe(404);
    expect(m.availableNewsletter).toHaveBeenCalledWith({
      where: {
        projectId: NEWSLETTER_PROJECT_ID,
        workspaceId: NEWSLETTER_WORKSPACE_ID,
        workspace: { organization: { slug: "utxo" } },
      },
      select: { id: true },
    });
    expect(m.project).not.toHaveBeenCalled();
    expect(m.posts).not.toHaveBeenCalled();
    expect(m.assets).not.toHaveBeenCalled();
    expect(m.copy).not.toHaveBeenCalled();
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
    expect(m.eval).not.toHaveBeenCalled();
  });

  it("limits generation with a shared project counter before model calls", async () => {
    m.eval.mockResolvedValue(11);
    expect((await draft()).status).toBe(429);
    expect(m.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("expire", KEYS[1], 600)'),
      1,
      `newsletter:draft:${NEWSLETTER_WORKSPACE_ID}:${NEWSLETTER_PROJECT_ID}`,
    );
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { brief: " " },
    { brief: "x".repeat(10_001) },
    { ...INPUT, template: "OTHER" },
    { ...INPUT, imageIds: ["bad"] },
    { ...INPUT, approve: true },
    { ...INPUT, scheduledAt: "2026-11-01T10:00:00Z" },
    { ...INPUT, send: true },
  ])("rejects invalid or delivery inputs: %#", async (input) => {
    expect((await draft(input)).status).toBe(422);
    expect(m.project).not.toHaveBeenCalled();
    expect(m.generate).not.toHaveBeenCalled();
  });
});
