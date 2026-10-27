import { OpenAPIHono } from "@hono/zod-openapi";
import { renderNewsletterEmail } from "@sokosumi/email";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import {
  NEWSLETTER,
  NEWSLETTER_PROJECT_ID,
  NEWSLETTER_WORKSPACE_ID,
} from "@/test/newsletter";

import mount from "./post";

const m = vi.hoisted(() => ({
  enabled: true,
  workspace: vi.fn(),
  project: vi.fn(),
  newsletter: vi.fn(),
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
    workspace: { findUnique: m.workspace },
    project: { findFirst: m.project },
    newsletter: { findUnique: m.newsletter },
  },
}));

const INPUT = {
  subject: "Hello readers",
  previewText: "This week's news",
  template: "TEXT",
  content: [{ type: "heading", text: "Hello <script>bad</script>", level: 1 }],
} as const;
const BRAND = {
  accentColor: "#123456",
  logoUrl: "https://example.com/logo.png",
  footerText: "Our footer",
};

function app(authenticated = true) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    if (!authenticated) throw unauthorized("Unauthorized");
    c.set("requestId", "newsletter_preview_test");
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
  mount(app);
  app.onError(errorHandler);
  return app;
}

function preview(body: unknown = INPUT, authenticated = true) {
  return app(authenticated).request(
    `/${NEWSLETTER_PROJECT_ID}/newsletter/issues/preview`,
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
  m.workspace.mockResolvedValue({ organization: { slug: "utxo" } });
  m.project.mockResolvedValue({
    id: NEWSLETTER_PROJECT_ID,
    closingAt: null,
    closedAt: null,
  });
  m.newsletter.mockResolvedValue({ ...NEWSLETTER, brand: BRAND });
});

describe("POST newsletter issue preview", () => {
  it("returns the sending renderer's branded HTML and placeholder unsubscribe link", async () => {
    const response = await preview();
    expect(response.status).toBe(200);
    const { data } = await response.json();
    const rendered = await renderNewsletterEmail({
      newsletter: { name: NEWSLETTER.name, brand: BRAND },
      issue: { ...INPUT, content: [...INPUT.content] },
      unsubscribeUrl: "#",
    });
    expect(data).toEqual({ html: rendered.html });
    expect(data.html).toContain("Our footer");
    expect(data.html).toContain(BRAND.logoUrl);
    expect(data.html).toContain('href="#"');
    expect(data.html).not.toContain("<script>");
    expect(m.workspace).toHaveBeenCalledWith({
      where: { id: NEWSLETTER_WORKSPACE_ID },
      select: { organization: { select: { slug: true } } },
    });
    expect(m.project).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: NEWSLETTER_PROJECT_ID,
          workspaceId: NEWSLETTER_WORKSPACE_ID,
        }),
      }),
    );
    expect(m.newsletter).toHaveBeenCalledWith({
      where: {
        projectId: NEWSLETTER_PROJECT_ID,
        workspaceId: NEWSLETTER_WORKSPACE_ID,
      },
    });
  });

  it("returns 404 before reading project data when disabled", async () => {
    m.enabled = false;
    expect((await preview()).status).toBe(404);
    expect(m.project).not.toHaveBeenCalled();
    expect(m.workspace).not.toHaveBeenCalled();
  });

  it.each([
    { organization: { slug: "another-workspace" } },
    { organization: null },
    null,
  ])(
    "returns 404 outside the beta workspace before reading project data",
    async (workspace) => {
      m.workspace.mockResolvedValue(workspace);
      expect((await preview()).status).toBe(404);
      expect(m.project).not.toHaveBeenCalled();
      expect(m.newsletter).not.toHaveBeenCalled();
    },
  );

  it("requires authentication and an accessible project with newsletter settings", async () => {
    expect((await preview(INPUT, false)).status).toBe(401);
    m.project.mockResolvedValue(null);
    expect((await preview()).status).toBe(404);
    expect(m.newsletter).not.toHaveBeenCalled();
    m.project.mockResolvedValue({ id: NEWSLETTER_PROJECT_ID });
    m.newsletter.mockResolvedValue(null);
    expect((await preview()).status).toBe(404);
  });

  it.each([
    { ...INPUT, subject: "" },
    { ...INPUT, template: "OTHER" },
    {
      ...INPUT,
      content: [{ type: "image", url: "http://example.com/a.png", alt: "" }],
    },
    {
      ...INPUT,
      content: [{ type: "button", label: "Read", url: "javascript:alert(1)" }],
    },
    { ...INPUT, content: [{ type: "html", html: "<script>bad</script>" }] },
  ])("rejects invalid content before accessing data", async (input) => {
    expect((await preview(input)).status).toBe(422);
    expect(m.project).not.toHaveBeenCalled();
  });
});
