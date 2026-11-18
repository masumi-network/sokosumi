import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import type { SeoActor } from "@/schemas/project-seo.schema";
import {
  addProjectSeoPage,
  getProjectSeoWorkspace,
} from "./project-seo.service";
import { recordProjectSeoPageChange } from "./project-seo-page-changes.service";
import { getSeoBrief, saveSeoBrief } from "./seo-audit-brief.service";
import { pinSeoAuditBrief } from "./seo-audit-brief-dispatch";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const userId = randomUUID(),
  workspaceId = randomUUID(),
  projectId = randomUUID();
const actor: SeoActor = {
  owner: { kind: "project", id: projectId },
  workspaceId,
  userId,
  organizationId: null,
};
describe.skipIf(!enabled)("immutable private SEO briefs", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Brief fixture",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.project.create({
      data: { id: projectId, workspaceId, name: "Brief fixture" },
    });
  });
  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });
  it("serializes simultaneous edits and keeps notes out of the shared workspace and other actors", async () => {
    const p = await addProjectSeoPage(actor, {
      url: "https://example.test/pricing",
      relationship: "primary",
    });
    const initial = await getSeoBrief(actor);
    expect(initial).toMatchObject({
      revision: 0,
      pages: [],
      followUps: [],
      priorities: [],
    });
    const content = {
      objective: "sales",
      audience: "private-audience",
      outcome: null,
      constraints: null,
      pages: [
        {
          pageId: p.id,
          job: null,
          role: "pricing",
          action: "buy",
          indexIntent: "index",
        },
      ],
    };
    const attempts = await Promise.allSettled(
      ["First", "Second"].map((outcome) =>
        saveSeoBrief(actor, { ...content, outcome, expectedRevision: 0 }),
      ),
    );
    expect(
      attempts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason.status),
    ).toEqual([409]);
    const saved = await getSeoBrief(actor);
    expect(saved).toMatchObject({ revision: 1, audience: "private-audience" });
    const second = await saveSeoBrief(actor, {
      ...content,
      expectedRevision: 1,
      outcome: "Final",
    });
    expect(second.revision).toBe(2);
    const retried = await saveSeoBrief(actor, {
      ...content,
      expectedRevision: 1,
      outcome: "Final",
    });
    expect(retried.revision).toBe(second.revision);
    expect(retried.updatedAt).toBe(second.updatedAt);
    await expect(
      saveSeoBrief(actor, {
        ...content,
        expectedRevision: 0,
        outcome: "Final",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await prisma.projectSeoObservation.count({
        where: {
          projectId,
          ownerId: userId,
          kind: "audit_brief",
          visibility: "PRIVATE",
        },
      }),
    ).toBe(2);
    expect(JSON.stringify(await getProjectSeoWorkspace(actor))).not.toContain(
      "private-audience",
    );
    await expect(
      getSeoBrief({ ...actor, userId: randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      saveSeoBrief(actor, {
        ...content,
        expectedRevision: 2,
        pages: [{ ...content.pages[0], pageId: randomUUID() }],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("joins the observed Google crawl to the exact changed URL and pins the approved brief revision", async () => {
    const page = await addProjectSeoPage(actor, {
      url: "https://example.test/compare",
      relationship: "primary",
    });
    const original = await getSeoBrief(actor);
    const content = {
      outcome: null,
      objective: "sales",
      audience: "private audience",
      constraints: null,
      pages: [
        {
          pageId: page.id,
          role: "comparison",
          job: "private page job",
          action: "buy",
          indexIntent: "index",
        },
      ],
    };
    const saved = await saveSeoBrief(actor, {
      ...content,
      expectedRevision: original.revision,
    });
    const runId = randomUUID();
    const approval = { revision: saved.revision, pageIds: [page.id] };
    const shared = await prisma.$transaction((tx) =>
      pinSeoAuditBrief(tx, actor, runId, [page], approval),
    );
    expect(shared).toEqual({
      pages: [{ url: page.url, role: "comparison", action: "buy" }],
    });
    await saveSeoBrief(actor, {
      ...content,
      audience: "revised private audience",
      expectedRevision: saved.revision,
    });
    await expect(
      prisma.$transaction((tx) =>
        pinSeoAuditBrief(tx, actor, randomUUID(), [page], approval),
      ),
    ).rejects.toMatchObject({ status: 409 });
    const pinned = await prisma.projectSeoObservation.findFirstOrThrow({
      where: {
        projectId,
        kind: "audit_brief_run",
        sourceKey: `audit-brief-run:${runId}`,
        visibility: "PRIVATE",
        ownerId: userId,
      },
    });
    expect(pinned.payload).toMatchObject({
      revision: saved.revision,
      sharedPageIds: [page.id],
    });
    const changedAt = "2026-06-03T00:00:00.000Z";
    await recordProjectSeoPageChange(actor, {
      pageIds: [page.id],
      occurredAt: changedAt,
      title: "Revised page",
      note: "",
      idempotencyKey: randomUUID(),
    });
    const inspect = (day: number, lastCrawlTime: string) => {
      const checkedAt = `2026-06-0${day}T00:00:00.000Z`;
      return prisma.projectSeoObservation.create({
        data: {
          projectId,
          kind: "index_inspection",
          source: "search_console",
          visibility: "PRIVATE",
          ownerId: userId,
          sourceKey: randomUUID(),
          artifactHash: "fixture",
          pageIds: [page.id],
          observedAt: new Date(checkedAt),
          payload: {
            receipt: {
              checkedAt,
              pages: [{ pageUrl: page.url, verdict: "PASS", lastCrawlTime }],
            },
          },
        },
      });
    };
    await inspect(4, "2026-06-02T00:00:00.000Z");
    expect((await getSeoBrief(actor)).followUps).toEqual([
      {
        pageId: page.id,
        changedAt,
        outcomes: [],
        lastCrawlAt: "2026-06-02T00:00:00.000Z",
        status: "awaiting_recrawl",
        indexReview: "unknown",
      },
    ]);
    await inspect(6, "2026-06-05T00:00:00.000Z");
    expect((await getSeoBrief(actor)).followUps).toEqual([
      {
        pageId: page.id,
        changedAt,
        outcomes: [],
        lastCrawlAt: "2026-06-05T00:00:00.000Z",
        status: "recrawled",
        indexReview: "matches_intent",
      },
    ]);
    const makeOutcome = (
      from: string,
      to: string,
      count: number,
      visibility = "PRIVATE",
    ) =>
      prisma.projectSeoObservation.create({
        data: {
          projectId,
          ownerId: userId,
          kind: "landing_outcomes",
          source: "ga4",
          visibility,
          sourceKey: randomUUID(),
          pageIds: [page.id],
          artifactHash: "fixture",
          observedAt: new Date("2026-06-20T00:00:00Z"),
          payload: {
            version: 1,
            channel: "organic",
            accountKey: "a".repeat(64),
            propertyId: "properties/one",
            verifiedHost: "example.test",
            timeZone: "UTC",
            from,
            to,
            rows: [{ pageUrl: page.url, event: "purchase", count }],
          },
        },
      });
    const before = { from: "2026-05-27", to: "2026-06-02", count: 2 },
      after = { from: "2026-06-04", to: "2026-06-10", count: 3 };
    await makeOutcome(before.from, before.to, before.count);
    await makeOutcome(after.from, after.to, after.count);
    await makeOutcome("2026-06-11", "2026-06-17", 999, "SHARED");
    const privateBrief = await getSeoBrief(actor);
    expect(privateBrief.followUps[0].outcomes).toEqual([
      { event: "purchase", latest: after, comparison: { before, after } },
    ]);
    expect(JSON.stringify(await getProjectSeoWorkspace(actor))).not.toContain(
      '"purchase"',
    );
  });
});
