import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import { unavailableGscTaskInspection } from "@/lib/seo/native-gsc-task-inspection";
import type { SeoActor } from "@/schemas/project-seo.schema";
import {
  addProjectSeoPage,
  getProjectSeoWorkspace,
} from "./project-seo.service";
import { recordProjectSeoPageChange } from "./project-seo-page-changes.service";
import {
  getSeoBrief,
  getSeoBriefSuggestion,
  saveSeoBrief,
} from "./seo-audit-brief.service";
import { pinSeoAuditBrief } from "./seo-audit-brief-dispatch";
import { loadBriefFollowUps } from "./seo-audit-brief-follow-up";

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
  it("only suggests actions for a saved page in the requesting user's collection", async () => {
    const page = await addProjectSeoPage(actor, {
      url: "https://suggestion.example.test/",
      relationship: "primary",
    });
    expect(await getSeoBriefSuggestion(actor, page.id)).toEqual({
      action: null,
    });
    const other = await prisma.project.create({
      data: { id: randomUUID(), workspaceId, name: "Other collection" },
    });
    await expect(
      getSeoBriefSuggestion(
        { ...actor, owner: { kind: "project", id: other.id } },
        page.id,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      getSeoBriefSuggestion({ ...actor, userId: randomUUID() }, page.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      getSeoBriefSuggestion({ ...actor, sokoBotId: randomUUID() }, page.id),
    ).rejects.toMatchObject({ status: 403 });
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

  it.each(["index_inspection", "metrics", "metrics_with_page_times"])(
    "uses the actual Google read time when a later %s reuses an older inspection",
    async (source) => {
      const perPage = source === "metrics_with_page_times";
      const kind = perPage ? "metrics" : source;
      const page = await addProjectSeoPage(actor, {
        url: `https://example.test/newest-${source}`,
        relationship: "primary",
      });
      const first = "2026-06-02T10:00:00.000Z";
      const second = "2026-06-02T11:00:00.000Z";
      const retry = "2026-06-02T12:00:00.000Z";
      const otherUrl = "https://example.test/related-page";
      const row = {
        projectId,
        kind,
        source: "search_console",
        visibility: "PRIVATE" as const,
        ownerId: userId,
        pageIds: [page.id],
        artifactHash: "fixture",
      };
      const indexed = {
        pageUrl: page.url,
        verdict: "PASS",
        indexingState: "INDEXING_ALLOWED",
        lastCrawlTime: second,
      };
      await prisma.projectSeoObservation.createMany({
        data: [
          {
            ...row,
            sourceKey: randomUUID(),
            observedAt: new Date(second),
            payload:
              kind === "metrics"
                ? { indexedPages: [indexed] }
                : {
                    receipt: {
                      taskId: randomUUID(),
                      checkedAt: second,
                      pages: [indexed],
                    },
                  },
          },
          {
            ...row,
            sourceKey: randomUUID(),
            observedAt: new Date(retry),
            payload:
              kind === "metrics"
                ? {
                    collectedAt: perPage ? retry : first,
                    ...(perPage && {
                      inspectionCache: {
                        key: "a".repeat(64),
                        readUrls: [],
                        checkedAt: { [page.url]: first },
                      },
                    }),
                    indexedPages: [
                      { ...indexed, verdict: "FAIL", lastCrawlTime: first },
                    ],
                  }
                : {
                    reusedCheckedAt: { [page.url]: first },
                    receipt: {
                      taskId: randomUUID(),
                      checkedAt: retry,
                      pages: [
                        { ...indexed, verdict: "FAIL", lastCrawlTime: first },
                        { ...indexed, pageUrl: otherUrl, lastCrawlTime: retry },
                      ],
                    },
                  },
          },
        ],
      });
      const [followUp] = await loadBriefFollowUps(
        actor,
        {
          objective: "support",
          audience: null,
          constraints: null,
          outcome: null,
          pages: [
            {
              pageId: page.id,
              role: "support",
              action: "read",
              job: null,
              indexIntent: "index",
            },
          ],
        },
        [page],
        prisma,
      );
      expect(followUp).toMatchObject({
        indexReview: "matches_intent",
        lastCrawlAt: second,
      });
    },
  );

  it.each(["metrics", "index_inspection"])(
    "keeps the last %s read through an inspection outage until Google answers",
    async (source) => {
      const page = await addProjectSeoPage(actor, {
        url: `https://example.test/inspections/${source}`,
        relationship: "primary",
      });
      const original = "2026-06-15T10:00:00.000Z";
      const latest = "2026-06-15T11:00:00.000Z";
      const unanswered = unavailableGscTaskInspection(page.url);
      const indexed = {
        ...unanswered,
        verdict: "PASS",
        lastCrawlTime: original,
      };
      const row = {
        projectId,
        kind: source,
        source: "search_console",
        ownerId: userId,
        visibility: "PRIVATE" as const,
        pageIds: [page.id],
        artifactHash: "fixture",
      };
      await prisma.projectSeoObservation.create({
        data: {
          ...row,
          sourceKey: randomUUID(),
          observedAt: new Date(original),
          payload:
            source === "metrics"
              ? { indexedPages: [indexed] }
              : {
                  receipt: {
                    checkedAt: original,
                    status: "available",
                    pages: [indexed],
                  },
                },
        },
      });
      const partial = {
        checkedAt: latest,
        status: "unavailable",
        pages: [unanswered],
      };
      const newest = await prisma.projectSeoObservation.create({
        data: {
          ...row,
          kind: "index_inspection",
          sourceKey: randomUUID(),
          observedAt: new Date(latest),
          payload: { propertyId: "sc-domain:example.test", receipt: partial },
        },
      });
      const read = async () =>
        (
          await loadBriefFollowUps(
            actor,
            {
              objective: "support",
              outcome: null,
              audience: null,
              constraints: null,
              pages: [
                {
                  pageId: page.id,
                  role: "support",
                  action: "read",
                  job: null,
                  indexIntent: "index",
                },
              ],
            },
            [page],
            prisma,
          )
        )[0];
      const originalVerdict = {
        indexReview: "matches_intent",
        lastCrawlAt: original,
      };
      expect(await read()).toMatchObject(originalVerdict);
      await prisma.projectSeoObservation.update({
        where: { id: newest.id },
        data: {
          payload: {
            propertyId: "https://example.test/elsewhere/",
            providerAnsweredAll: true,
            receipt: partial,
          },
        },
      });
      expect(await read()).toMatchObject(originalVerdict);
      for (const answers of [
        { providerAnsweredAll: true },
        { answeredUnknownPageUrls: [page.url] },
      ]) {
        await prisma.projectSeoObservation.update({
          where: { id: newest.id },
          data: {
            payload: {
              propertyId: "sc-domain:example.test",
              ...answers,
              receipt: partial,
            },
          },
        });
        expect(await read()).toMatchObject({
          indexReview: "unknown",
          lastCrawlAt: null,
        });
      }
    },
  );

  it("keeps the private exclusion evidence for the same Google crawl after a legacy statistics sync", async () => {
    const page = await addProjectSeoPage(actor, {
      url: "https://example.test/retired-guide",
      relationship: "primary",
    });
    const pageUrl = page.url;
    const lastCrawlTime = "2026-06-01T00:00:00Z";
    const state = { pageUrl, lastCrawlTime, verdict: "NEUTRAL" };
    const row = {
      projectId,
      source: "search_console",
      visibility: "PRIVATE" as const,
      ownerId: userId,
      artifactHash: "fixture",
      pageIds: [page.id],
    };
    await prisma.projectSeoObservation.create({
      data: {
        ...row,
        kind: "index_inspection",
        sourceKey: randomUUID(),
        observedAt: new Date("2026-06-02T00:00:00Z"),
        payload: {
          receipt: {
            checkedAt: "2026-06-02T00:00:00Z",
            pages: [{ ...state, indexingState: "BLOCKED_BY_META_TAG" }],
          },
        },
      },
    });
    const metric = await prisma.projectSeoObservation.create({
      data: {
        ...row,
        kind: "metrics",
        sourceKey: randomUUID(),
        observedAt: new Date("2026-06-03T00:00:00Z"),
        payload: { indexedPages: [state] },
      },
    });
    const followUp = () =>
      loadBriefFollowUps(
        actor,
        {
          objective: "support",
          outcome: null,
          audience: null,
          constraints: null,
          pages: [
            {
              pageId: page.id,
              role: "support",
              action: "read",
              job: null,
              indexIntent: "exclude",
            },
          ],
        },
        [page],
        prisma,
      );
    expect((await followUp())[0]?.indexReview).toBe("expected_exclusion");
    for (const different of [
      { ...state, lastCrawlTime: "2026-06-02T12:00:00Z" },
      { ...state, verdict: "FAIL" },
      { ...state, indexingState: null },
    ]) {
      await prisma.projectSeoObservation.update({
        where: { id: metric.id },
        data: { payload: { indexedPages: [different] } },
      });
      expect((await followUp())[0]?.indexReview).toBe("unknown");
    }
  });
});

describe.skipIf(!enabled)("owner-only GA4 goal priority", () => {
  const ownerId = randomUUID(),
    collaboratorId = randomUUID(),
    organizationId = randomUUID(),
    orgWorkspaceId = randomUUID(),
    orgProjectId = randomUUID();
  const base = {
    owner: { kind: "project" as const, id: orgProjectId },
    workspaceId: orgWorkspaceId,
    organizationId,
  };
  const owner: SeoActor = { ...base, userId: ownerId };
  const collaborator: SeoActor = { ...base, userId: collaboratorId };
  const pageUrl = "https://goal.example.test/signup";
  const accountKey = "a".repeat(64);
  beforeAll(async () => {
    const now = new Date();
    for (const id of [ownerId, collaboratorId])
      await prisma.user.create({
        data: {
          id,
          name: "Goal priority fixture",
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      });
    // No seat contract: on a free plan every member counts as seated.
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Goal priority fixture",
        slug: organizationId,
        workspace: { create: { id: orgWorkspaceId } },
        members: {
          create: [{ userId: ownerId }, { userId: collaboratorId }],
        },
      },
    });
    await prisma.project.create({
      data: {
        id: orgProjectId,
        workspaceId: orgWorkspaceId,
        name: "Goal priority fixture",
      },
    });
  });
  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: orgWorkspaceId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, collaboratorId] } },
    });
  });

  it("shows the GA4 goal decline and its next step only to the owner who read it, until access or the source changes", async () => {
    const page = await addProjectSeoPage(owner, {
      url: pageUrl,
      relationship: "primary",
    });
    const goal = {
      objective: "sales",
      audience: null,
      outcome: null,
      constraints: null,
      pages: [
        {
          pageId: page.id,
          job: null,
          role: "product",
          action: "sign up",
          indexIntent: "index",
        },
      ],
      expectedRevision: 0,
    };
    await saveSeoBrief(owner, goal);
    await saveSeoBrief(collaborator, goal);
    const stored = (payload: object, at: string) =>
      prisma.projectSeoObservation.create({
        data: {
          projectId: orgProjectId,
          ownerId,
          visibility: "PRIVATE",
          kind: "landing_outcomes",
          source: "ga4",
          sourceKey: `landing-outcomes:${randomUUID()}`,
          artifactHash: randomUUID(),
          pageIds: [page.id],
          payload,
          observedAt: new Date(at),
        },
      });
    await stored(
      {
        version: 1,
        channel: "organic",
        accountKey,
        propertyId: "properties/123",
        verifiedHost: "goal.example.test",
        timeZone: "Europe/Berlin",
        from: "2026-09-15",
        to: "2026-09-28",
        rows: [{ pageUrl, event: "sign_up", count: 12 }],
        goalInvestigation: {
          pageUrl,
          timeZone: "Europe/Berlin",
          event: "sign_up",
          before: {
            from: "2026-09-01",
            to: "2026-09-14",
            organic: { sessions: 400, rate: 0.05 },
            direct: { sessions: 200, rate: 0.04 },
          },
          after: {
            from: "2026-09-15",
            to: "2026-09-28",
            organic: { sessions: 420, rate: 0.03 },
            direct: { sessions: 210, rate: 0.04 },
          },
          assessment: "organic_declined",
        },
      },
      "2026-09-30T12:00:00.000Z",
    );
    const [priority] = (await getSeoBrief(owner)).priorities;
    expect(priority).toMatchObject({
      pageId: page.id,
      nextStep: expect.stringContaining("Search Console"),
      why: expect.arrayContaining([
        expect.stringContaining("GA4 sign_up rate: organic search 5.0%"),
      ]),
    });
    // A collaborator on the same page and goal reads only their own private records.
    const shared = await getSeoBrief(collaborator);
    expect(shared.followUps[0]?.goalInvestigation).toBeUndefined();
    expect(JSON.stringify(shared.priorities)).not.toMatch(
      /sign_up rate|Search Console/,
    );
    expect(
      JSON.stringify(
        await getProjectSeoWorkspace(collaborator, { pageId: page.id }),
      ),
    ).not.toMatch(/goalInvestigation|sign_up rate/);
    // A later source selection without counts retires the older decision.
    await stored(
      { version: 2, accountKey, propertyId: "properties/456" },
      "2026-10-02T12:00:00.000Z",
    );
    expect(JSON.stringify((await getSeoBrief(owner)).priorities)).not.toMatch(
      /sign_up rate|Search Console/,
    );
    // A member who left the organization reads nothing.
    await prisma.member.deleteMany({
      where: { organizationId, userId: ownerId },
    });
    await expect(getSeoBrief(owner)).rejects.toMatchObject({ status: 404 });
  });
});
