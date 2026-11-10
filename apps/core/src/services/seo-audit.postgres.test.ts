import { randomUUID } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import audits from "@/routes/v1/seo/audits";
import {
  requestSeoAnalysisSchema,
  type SeoActor,
} from "@/schemas/project-seo.schema";
import {
  addProjectSeoPage,
  createProjectSeoScope,
  getProjectSeoWorkspace,
  saveProjectSeoCompetitor,
  saveProjectSeoKeyword,
} from "./project-seo.service";
import { requestProjectSeoAnalysis } from "./project-seo-operations.service";
import { createSeoAudit, listSeoAudits } from "./seo-audit.service";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const userId = randomUUID(),
  workspaceId = randomUUID(),
  foreignUserId = randomUUID(),
  foreignWorkspaceId = randomUUID();
const actor = { userId, workspaceId, organizationId: null };
const foreignActor = {
  userId: foreignUserId,
  workspaceId: foreignWorkspaceId,
  organizationId: null,
};
const firstPage = {
  url: "https://example.test/landing#section",
  relationship: "primary" as const,
};
function auditActor(id: string): SeoActor {
  return { ...actor, owner: { kind: "audit", id } };
}

function routeApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "native-seo-audit-test");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId: null,
      role: "user",
    });
    c.set("workspaceContext", { userId, workspaceId, organizationId: null });
    await next();
  });
  app.onError((error, c) =>
    c.json(
      { error: error.message },
      error instanceof HTTPException ? error.status : 500,
    ),
  );
  app.route("/seo/audits", audits);
  return app;
}

describe.skipIf(!enabled)("Workspace-owned SEO Audits", () => {
  beforeAll(async () => {
    for (const [id, ws] of [
      [userId, workspaceId],
      [foreignUserId, foreignWorkspaceId],
    ])
      await prisma.user.create({
        data: {
          id,
          name: "Independent SEO audit fixture",
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          workspace: { create: { id: ws } },
        },
      });
  });
  afterAll(async () => {
    await prisma.task.deleteMany({
      where: { workspaceId: { in: [workspaceId, foreignWorkspaceId] } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceId, foreignWorkspaceId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userId, foreignUserId] } },
    });
    await prisma.$disconnect();
  });

  it("creates the first Audit and page through HTTP without a Project or provider call", async () => {
    expect(await prisma.project.count({ where: { workspaceId } })).toBe(0);
    const response = await routeApp().request("http://localhost/seo/audits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Landing pages", firstPage }),
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toMatchObject({
      projectId: null,
      auditName: "Landing pages",
      pages: [{ url: "https://example.test/landing" }],
    });
    const id: string = body.data.auditId;
    expect(await prisma.seoAudit.findUnique({ where: { id } })).toMatchObject({
      workspaceId,
      createdById: userId,
      projectId: null,
    });
    expect(
      await prisma.projectSeoPage.findMany({ where: { auditId: id } }),
    ).toMatchObject([{ projectId: null, auditId: id }]);
    expect(await prisma.project.count({ where: { workspaceId } })).toBe(0);
    const detail = await routeApp().request(
      `http://localhost/seo/audits/${id}`,
    );
    expect(detail.status).toBe(200);
    expect((await detail.json()).data.auditId).toBe(id);
  });

  it("isolates the same URL, keyword and competitor across Audits and rejects foreign page membership", async () => {
    const first = await createSeoAudit(actor, {
      name: "First collection",
      firstPage,
    });
    const second = await createSeoAudit(actor, {
      name: "Second collection",
      firstPage,
    });
    if (!first.auditId || !second.auditId)
      throw new Error("Expected real Audit identities");
    const a = auditActor(first.auditId),
      b = auditActor(second.auditId);
    expect(first.pages[0].id).not.toBe(second.pages[0].id);
    await expect(
      createProjectSeoScope(a, {
        name: "Foreign pages",
        pageIds: [second.pages[0].id],
      }),
    ).rejects.toMatchObject({ status: 404 });
    const keyword = {
      keyword: "release",
      countryCode: "US",
      languageCode: "en",
      priority: "medium" as const,
      saved: true,
    };
    expect((await saveProjectSeoKeyword(a, keyword)).id).not.toBe(
      (await saveProjectSeoKeyword(b, keyword)).id,
    );
    const competitor = {
      url: "https://competitor.example.test/",
      confirmed: true,
    };
    expect((await saveProjectSeoCompetitor(a, competitor)).id).not.toBe(
      (await saveProjectSeoCompetitor(b, competitor)).id,
    );
    await expect(
      getProjectSeoWorkspace({ ...foreignActor, owner: a.owner }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      addProjectSeoPage(
        { ...foreignActor, owner: a.owner },
        { url: "https://example.test/forbidden", relationship: "primary" },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("paginates only real Audits in the active Workspace and refuses a foreign cursor", async () => {
    const foreign = await createSeoAudit(foreignActor, {
      name: "Foreign collection",
      firstPage,
    });
    const first = await listSeoAudits(actor, { limit: 1 });
    expect(first.audits).toHaveLength(1);
    expect(first.pagination.nextCursor).toBe(first.audits[0].id);
    const second = await listSeoAudits(actor, {
      limit: 1,
      cursor: first.pagination.nextCursor ?? undefined,
    });
    expect(second.audits[0].id).not.toBe(first.audits[0].id);
    expect(first.pagination.total).toBe(
      await prisma.seoAudit.count({ where: { workspaceId } }),
    );
    await expect(
      listSeoAudits(actor, { cursor: foreign.auditId ?? "", limit: 1 }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("lists only the scoped Project's Audits and refuses a foreign Project scope", async () => {
    const project = await prisma.project.create({
      data: { workspaceId, name: "Scoped SEO Project" },
    });
    const linked = await createSeoAudit(actor, {
      name: "Linked Audit",
      firstPage,
      projectId: project.id,
    });
    const scoped = await listSeoAudits(actor, { projectId: project.id });
    expect(scoped.audits.map((audit) => audit.id)).toEqual([linked.auditId]);
    expect(scoped.pagination.total).toBe(1);
    const all = await listSeoAudits(actor, { limit: 100 });
    expect(all.audits.length).toBeGreaterThan(1);
    const foreignProject = await prisma.project.create({
      data: { workspaceId: foreignWorkspaceId, name: "Foreign scope" },
    });
    await expect(
      listSeoAudits(actor, { projectId: foreignProject.id }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects a foreign optional Project link without retaining an Audit or its first page", async () => {
    const foreignProject = await prisma.project.create({
      data: { workspaceId: foreignWorkspaceId, name: "Foreign native Project" },
    });
    const before = await prisma.seoAudit.count({ where: { workspaceId } });
    await expect(
      createSeoAudit(actor, {
        name: "Forbidden link",
        firstPage,
        projectId: foreignProject.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await prisma.seoAudit.count({ where: { workspaceId } })).toBe(
      before,
    );
  });

  it("keeps linked Audit history readable and blocks edits or new Tasks after its Project closes", async () => {
    const project = await prisma.project.create({
      data: { workspaceId, name: "Optional native link" },
    });
    const audit = await createSeoAudit(actor, {
      name: "Independent linked Audit",
      firstPage,
      projectId: project.id,
    });
    if (!audit.auditId) throw new Error("Expected an Audit identity");
    await prisma.project.update({
      where: { id: project.id },
      data: { closedAt: new Date() },
    });
    const owner = auditActor(audit.auditId);
    await expect(
      addProjectSeoPage(owner, {
        url: "https://example.test/related",
        relationship: "related",
        relatedToPageId: audit.pages[0].id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await getProjectSeoWorkspace(owner)).availableActions.canEdit).toBe(
      false,
    );
    const previous = getEnv().SEO_ANALYSIS_DISPATCH_ENABLED;
    getEnv().SEO_ANALYSIS_DISPATCH_ENABLED = true;
    try {
      await expect(
        requestProjectSeoAnalysis(
          owner,
          requestSeoAnalysisSchema.parse({
            kind: "page_check",
            pageIds: [audit.pages[0].id],
            countryCode: "US",
            languageCode: "en",
            devices: ["desktop"],
            coworkerId: randomUUID(),
            idempotencyKey: "closed-project-must-not-dispatch",
          }),
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        await prisma.projectSeoAnalysis.count({
          where: { auditId: audit.auditId },
        }),
      ).toBe(0);
      expect(
        await prisma.task.count({ where: { projectId: project.id } }),
      ).toBe(0);
    } finally {
      getEnv().SEO_ANALYSIS_DISPATCH_ENABLED = previous;
    }
  });
});
