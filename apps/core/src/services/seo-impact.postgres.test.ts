/**
 * SEO impact tracking against PostgreSQL: rows for done page changes, and the
 * wait for Google's first crawl after each change.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/seo-impact.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { forgetEvalWorkspaces } from "@/lib/evals/eval-guard";
import { propertyChoices } from "@/services/project-seo-statistics.service";
import { expectCoreLog } from "@/test/core-log";
import { listAdminSeoImpactVerdicts } from "./admin-seo-impact";
import { CmoConflictError } from "./cmo-cuso.service";
import { setCmoSeoSuggestionStatus } from "./cmo-seo-status.service";
import { IMPACT_CRAWL_WAIT_DAYS, syncSeoImpact } from "./seo-impact.service";
import { updateSeoSuggestion } from "./seo-impact-record";

/** Google's last crawl per page URL, or an Error for a refused inspection. */
const lastCrawl = new Map<string, string | Error>();
/** The Search Console properties Cuso's account can read. */
const properties: string[] = [];
/** Runs before each URL Inspection answers, with the inspected page. */
const beforeAnswer = vi.fn(async (_pageUrl: string) => {});

// Google is the boundary: the property list and URL Inspection are faked.
vi.mock("@/services/project-seo-statistics.service", async (original) => ({
  ...(await original<
    typeof import("@/services/project-seo-statistics.service")
  >()),
  propertyChoices: vi.fn(async () => ({
    provider: "search_console",
    properties: properties.map((id) => ({ id, name: id })),
    status: "available",
    reason: null,
  })),
  readNativeSeoTool: vi.fn(
    async (_account: unknown, _slug: string, args: Record<string, unknown>) => {
      await beforeAnswer(String(args.inspection_url));
      const crawl = lastCrawl.get(String(args.inspection_url));
      if (crawl instanceof Error) throw crawl;
      return {
        successful: true,
        data: {
          inspectionResult: {
            indexStatusResult: {
              verdict: "PASS",
              ...(crawl ? { lastCrawlTime: crawl } : {}),
            },
          },
        },
      };
    },
  ),
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const userId = randomUUID(),
  organizationId = randomUUID(),
  workspaceId = randomUUID(),
  projectId = randomUUID(),
  copyProjectId = randomUUID(),
  evalOrganizationId = randomUUID(),
  evalWorkspaceId = randomUUID(),
  evalProjectId = randomUUID(),
  evalCusoProjectId = randomUUID(),
  failingProjectId = randomUUID();
const EVAL_LANE = 9_000_000 + Math.floor(Math.random() * 1_000_000);
const env = getEnv();
const previous = env.SEO_IMPACT_TRACKING_ENABLED;

const CHANGED_AT = new Date("2026-11-20T10:00:00Z");

async function doneChange(
  pageUrl: string,
  options: { project?: string; doneAt?: Date; status?: string } = {},
) {
  return await prisma.projectSeoSuggestion.create({
    data: {
      projectId: options.project ?? projectId,
      kind: "page_change",
      key: `test:${randomUUID()}`,
      source: "cuso",
      title: "Name the battery app in the title",
      pageUrl,
      why: "Searchers look for the app by name.",
      body: "Put the app name first.",
      evidence: [],
      status: options.status ?? "done",
      doneAt: options.doneAt ?? CHANGED_AT,
    },
    select: { id: true },
  });
}

/** Done page changes in one insert, ids in insert order. */
async function doneChanges(project: string, count: number, pageUrl?: string) {
  await prisma.projectSeoSuggestion.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      projectId: project,
      kind: "page_change",
      key: `test:${randomUUID()}`,
      source: "cuso",
      title: `Change ${index}`,
      pageUrl: pageUrl ?? `https://battery-sensei.app/page-${index}`,
      why: "Searchers look for the app by name.",
      body: "Put the app name first.",
      evidence: [],
      status: "done",
      doneAt: CHANGED_AT,
    })),
  });
}

const rowsOf = (suggestionId: string) =>
  prisma.projectSeoImpactVerdict.findMany({
    where: { suggestionId },
    orderBy: { changedAt: "asc" },
  });

describe.skipIf(!enabled)("SEO impact tracking against PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Ada Owner",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    for (const [org, workspace] of [
      [organizationId, workspaceId],
      [evalOrganizationId, evalWorkspaceId],
    ])
      await prisma.organization.create({
        data: {
          id: org,
          slug: org,
          name: "battery-sensei.app",
          workspace: { create: { id: workspace } },
          members: {
            create: { userId, role: "owner", seatAssignedAt: new Date() },
          },
        },
      });
    await prisma.project.createMany({
      data: [
        {
          id: projectId,
          workspaceId,
          name: "Cuso",
          websiteUrl: "https://battery-sensei.app/",
        },
        {
          id: copyProjectId,
          workspaceId,
          name: "Cuso test copy",
          websiteUrl: "https://battery-sensei.app/",
          testCopyOfProjectId: projectId,
        },
        {
          id: evalProjectId,
          workspaceId: evalWorkspaceId,
          name: "Eval workspace project",
          websiteUrl: "https://battery-sensei.app/",
        },
        {
          id: evalCusoProjectId,
          workspaceId,
          name: "Eval lane Cuso",
          websiteUrl: "https://battery-sensei.app/",
        },
        {
          id: failingProjectId,
          workspaceId,
          name: "Cuso with a refused connection",
          websiteUrl: "https://battery-sensei.app/",
        },
      ],
    });
    const failingBot = await prisma.sokoBot.create({
      data: {
        workspaceId,
        projectId: failingProjectId,
        userId: null,
        createdByUserId: userId,
        versionId: CMO_SOKO_BOT_VERSION_ID,
        name: "Cuso",
      },
    });
    await prisma.sokoBotIntegration.create({
      data: {
        sokoBotId: failingBot.id,
        provider: "google_search_console",
        composioAccountId: `ca_${randomUUID()}`,
        status: "ACTIVE",
      },
    });
    const bot = await prisma.sokoBot.create({
      data: {
        workspaceId,
        projectId,
        userId: null,
        createdByUserId: userId,
        versionId: CMO_SOKO_BOT_VERSION_ID,
        name: "Cuso",
      },
    });
    await prisma.sokoBotIntegration.create({
      data: {
        sokoBotId: bot.id,
        provider: "google_search_console",
        composioAccountId: `ca_${randomUUID()}`,
        status: "ACTIVE",
      },
    });
    await prisma.evalLane.create({
      data: {
        lane: EVAL_LANE,
        userId,
        organizationId: evalOrganizationId,
        workspaceId: evalWorkspaceId,
        sokoBotId: bot.id,
        cusoProjectId: evalCusoProjectId,
        world: {},
      },
    });
    forgetEvalWorkspaces();
  });

  beforeEach(async () => {
    env.SEO_IMPACT_TRACKING_ENABLED = true;
    lastCrawl.clear();
    properties.splice(0, Infinity, "sc-domain:battery-sensei.app");
    beforeAnswer.mockReset();
    vi.mocked(propertyChoices).mockClear();
    await prisma.projectSeoSuggestion.deleteMany({
      where: {
        projectId: {
          in: [
            projectId,
            copyProjectId,
            evalProjectId,
            evalCusoProjectId,
            failingProjectId,
          ],
        },
      },
    });
  });

  afterAll(async () => {
    env.SEO_IMPACT_TRACKING_ENABLED = previous;
    await prisma.evalLane.deleteMany({ where: { lane: EVAL_LANE } });
    forgetEvalWorkspaces();
    await prisma.sokoBot.deleteMany({ where: { workspaceId } });
    await prisma.project.deleteMany({
      where: { workspaceId: { in: [workspaceId, evalWorkspaceId] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationId, evalOrganizationId] } },
    });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("writes nothing while the flag is off", async () => {
    env.SEO_IMPACT_TRACKING_ENABLED = false;
    const { id } = await doneChange("https://battery-sensei.app/pricing");

    expect(await syncSeoImpact()).toMatchObject({ skipped: "disabled" });
    expect(await rowsOf(id)).toEqual([]);
  });

  it("records one row per change when two ticks run at once", async () => {
    const changes = await Promise.all(
      ["a", "b", "c"].map((page) =>
        doneChange(`https://battery-sensei.app/${page}`),
      ),
    );

    // Both ticks read the done changes before either inserts.
    const insert = prisma.projectSeoImpactVerdict.createMany;
    const { promise: bothRead, resolve } = Promise.withResolvers<void>();
    let arrived = 0;
    const spy = vi
      .spyOn(prisma.projectSeoImpactVerdict, "createMany")
      .mockImplementation((async (args: Parameters<typeof insert>[0]) => {
        arrived += 1;
        if (arrived === 2) resolve();
        await bothRead;
        return insert(args);
      }) as typeof insert);
    try {
      await Promise.all([syncSeoImpact(), syncSeoImpact()]);
    } finally {
      spy.mockRestore();
    }

    expect(arrived).toBe(2);
    for (const { id } of changes) expect(await rowsOf(id)).toHaveLength(1);
  });

  it("counts a crawl once when two ticks inspect the page at once", async () => {
    const pageUrl = "https://battery-sensei.app/pricing";
    await doneChange(pageUrl);
    lastCrawl.set(pageUrl, "2026-11-22T08:00:00Z");
    // Both ticks have Google's answer before either writes it.
    const { promise: bothAsked, resolve } = Promise.withResolvers<void>();
    let asked = 0;
    beforeAnswer.mockImplementation(async () => {
      asked += 1;
      if (asked === 2) resolve();
      await bothAsked;
    });

    const results = await Promise.all([syncSeoImpact(), syncSeoImpact()]);

    expect(asked).toBe(2);
    expect(results[0].crawled + results[1].crawled).toBe(1);
  });

  it("records both completions when a reopened change is done again before a tick", async () => {
    const { id } = await doneChange("https://battery-sensei.app/pricing", {
      status: "open",
    });
    const owner = { userId, projectId };
    const first = new Date("2026-11-21T10:00:00Z");
    const second = new Date("2026-11-23T10:00:00Z");
    await setCmoSeoSuggestionStatus(owner, id, "done", first);
    await setCmoSeoSuggestionStatus(owner, id, "open");
    await setCmoSeoSuggestionStatus(owner, id, "done", second);

    expect(await rowsOf(id)).toMatchObject([
      {
        changedAt: first,
        title: "Name the battery app in the title",
        kind: "page_change",
      },
      { changedAt: second },
    ]);
  });

  it("records one change when a done request is sent again", async () => {
    const { id } = await doneChange("https://battery-sensei.app/pricing", {
      status: "open",
    });
    const owner = { userId, projectId };
    // Both requests read the open suggestion before either writes.
    const read = prisma.projectSeoSuggestion.findFirst;
    const { promise: bothRead, resolve } = Promise.withResolvers<void>();
    let arrived = 0;
    const spy = vi
      .spyOn(prisma.projectSeoSuggestion, "findFirst")
      .mockImplementation(((args: Parameters<typeof read>[0]) => {
        const row = read(args);
        return (async () => {
          const value = await row;
          // Counted once the read is done: both reads finish before a write.
          arrived += 1;
          if (arrived === 2) resolve();
          if (arrived <= 2) await bothRead;
          return value;
        })();
      }) as typeof read);
    let answers: Awaited<ReturnType<typeof setCmoSeoSuggestionStatus>>[];
    try {
      answers = await Promise.all([
        setCmoSeoSuggestionStatus(owner, id, "done", CHANGED_AT),
        setCmoSeoSuggestionStatus(
          owner,
          id,
          "done",
          new Date(CHANGED_AT.getTime() + 1_000),
        ),
      ]);
    } finally {
      spy.mockRestore();
    }
    await setCmoSeoSuggestionStatus(owner, id, "done");

    expect(await rowsOf(id)).toHaveLength(1);
    const stored = await prisma.projectSeoSuggestion.findUniqueOrThrow({
      where: { id },
    });
    expect(stored.doneAt).toEqual(expect.any(Date));
    // The request that lost the race answers the stored change, not its own.
    const done = { status: "done", doneAt: stored.doneAt?.toISOString() };
    expect(answers).toEqual([
      expect.objectContaining(done),
      expect.objectContaining(done),
    ]);
  });

  it("reopens a change that the weekly check verified while the reopen ran", async () => {
    const { id } = await doneChange("https://battery-sensei.app/pricing");
    const owner = { userId, projectId };
    // The check writes verified after the reopen read the done change.
    const read = prisma.projectSeoSuggestion.findFirst;
    const spy = vi
      .spyOn(prisma.projectSeoSuggestion, "findFirst")
      .mockImplementationOnce((async (args: Parameters<typeof read>[0]) => {
        const row = await read(args);
        await prisma.projectSeoSuggestion.update({
          where: { id },
          data: { status: "verified", verifiedAt: CHANGED_AT },
        });
        return row;
      }) as typeof read);
    try {
      expect(await setCmoSeoSuggestionStatus(owner, id, "open")).toMatchObject({
        status: "open",
      });
    } finally {
      spy.mockRestore();
    }

    expect(
      await prisma.projectSeoSuggestion.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ status: "open", doneAt: null, verifiedAt: null });
  });

  it("answers a conflict when the change keeps moving under the write", async () => {
    const { id } = await doneChange("https://battery-sensei.app/pricing");
    // Another writer moves the status after each read.
    const read = prisma.projectSeoSuggestion.findFirst;
    const spy = vi
      .spyOn(prisma.projectSeoSuggestion, "findFirst")
      .mockImplementation((async (args: Parameters<typeof read>[0]) => {
        const row = await read(args);
        await prisma.projectSeoSuggestion.update({
          where: { id },
          data: { status: row?.status === "done" ? "dismissed" : "done" },
        });
        return row;
      }) as typeof read);
    try {
      await expect(
        setCmoSeoSuggestionStatus({ userId, projectId }, id, "open"),
      ).rejects.toBeInstanceOf(CmoConflictError);
    } finally {
      spy.mockRestore();
    }
  });

  it("records no second change when done is sent for a verified change", async () => {
    const { id } = await doneChange("https://battery-sensei.app/pricing", {
      status: "open",
    });
    const owner = { userId, projectId };
    await setCmoSeoSuggestionStatus(owner, id, "done", CHANGED_AT);
    // The weekly check found the change on the page.
    await prisma.projectSeoSuggestion.update({
      where: { id },
      data: { status: "verified", verifiedAt: CHANGED_AT },
    });

    expect(await setCmoSeoSuggestionStatus(owner, id, "done")).toMatchObject({
      status: "verified",
    });
    expect(await rowsOf(id)).toHaveLength(1);
  });

  it("records nothing on a status write while the flag is off", async () => {
    env.SEO_IMPACT_TRACKING_ENABLED = false;
    const { id } = await doneChange("https://battery-sensei.app/pricing", {
      status: "open",
    });

    await setCmoSeoSuggestionStatus({ userId, projectId }, id, "done");

    expect(await rowsOf(id)).toEqual([]);
  });

  it("records a verified change, and the stored title survives an edit", async () => {
    const { id } = await doneChange("https://battery-sensei.app/pricing", {
      status: "verified",
    });

    expect(await syncSeoImpact()).toMatchObject({ recorded: 1 });
    await prisma.projectSeoSuggestion.update({
      where: { id },
      data: { title: "A later title" },
    });
    const { rows } = await listAdminSeoImpactVerdicts({ period: "all" });
    expect(rows.find((row) => row.pageUrl.endsWith("/pricing"))).toMatchObject({
      suggestionTitle: "Name the battery app in the title",
    });
  });

  it("records nothing on a status write for a test copy or an eval project", async () => {
    const changes = await Promise.all(
      [copyProjectId, evalProjectId, evalCusoProjectId].map((project) =>
        doneChange("https://battery-sensei.app/pricing", {
          project,
          status: "open",
        }),
      ),
    );

    for (const { id } of changes) {
      await updateSeoSuggestion({
        where: { id },
        data: { status: "done", doneAt: CHANGED_AT },
      });
      expect(await rowsOf(id)).toEqual([]);
    }
  });

  it("skips test copies and eval projects", async () => {
    const copy = await doneChange("https://battery-sensei.app/pricing", {
      project: copyProjectId,
    });
    const evalChange = await doneChange("https://battery-sensei.app/pricing", {
      project: evalProjectId,
    });
    const evalCusoChange = await doneChange(
      "https://battery-sensei.app/pricing",
      { project: evalCusoProjectId },
    );

    await syncSeoImpact();

    expect(await rowsOf(copy.id)).toEqual([]);
    expect(await rowsOf(evalChange.id)).toEqual([]);
    expect(await rowsOf(evalCusoChange.id)).toEqual([]);
  });

  it("fixes the window on the first crawl after the change, and a later crawl does not move it", async () => {
    const pageUrl = "https://battery-sensei.app/pricing";
    const { id } = await doneChange(pageUrl);
    // 2026-11-22 00:00 PST: the second Pacific day after the change day.
    lastCrawl.set(pageUrl, "2026-11-22T08:00:00Z");
    await syncSeoImpact();
    lastCrawl.set(pageUrl, "2026-11-24T08:00:00Z");
    await syncSeoImpact(undefined, new Date(Date.now() + DAY_MS));

    expect(await rowsOf(id)).toMatchObject([
      {
        state: "waiting_window",
        reason: null,
        property: "sc-domain:battery-sensei.app",
        crawledAt: new Date("2026-11-22T08:00:00Z"),
        windowStart: new Date("2026-11-27T00:00:00Z"),
        windowEnd: new Date("2026-12-24T00:00:00Z"),
      },
    ]);
  });

  it.each([
    ["before", "2026-11-19T08:00:00Z"],
    ["at", CHANGED_AT.toISOString()],
  ])("ignores a crawl from %s the change", async (_when, crawl) => {
    const pageUrl = "https://battery-sensei.app/pricing";
    const { id } = await doneChange(pageUrl);
    lastCrawl.set(pageUrl, crawl);

    await syncSeoImpact();

    expect(await rowsOf(id)).toMatchObject([
      {
        state: "waiting_crawl",
        reason: "not_crawled_yet",
        crawledAt: null,
        windowStart: null,
      },
    ]);
  });

  it("inspects each page in the property that covers it", async () => {
    properties.splice(0, Infinity, "https://battery-sensei.app/docs/");
    const docs = await doneChange("https://battery-sensei.app/docs/start");
    const pricing = await doneChange("https://battery-sensei.app/pricing");
    lastCrawl.set(
      "https://battery-sensei.app/docs/start",
      "2026-11-22T08:00:00Z",
    );

    await syncSeoImpact();

    expect(await rowsOf(docs.id)).toMatchObject([
      { state: "waiting_window", property: "https://battery-sensei.app/docs/" },
    ]);
    expect(await rowsOf(pricing.id)).toMatchObject([
      { state: "waiting_crawl", reason: "no_property", property: null },
    ]);
    // One property list for the account, not one per page.
    expect(propertyChoices).toHaveBeenCalledOnce();
  });

  it("leaves audit recheck rows to their own rule", async () => {
    const { id } = await doneChange("https://battery-sensei.app/pricing", {
      status: "open",
    });
    await prisma.projectSeoImpactVerdict.create({
      data: {
        projectId,
        changeSource: "audit_recheck",
        suggestionId: id,
        changedAt: CHANGED_AT,
        pageUrl: "https://battery-sensei.app/pricing",
      },
    });

    expect(await syncSeoImpact()).toMatchObject({ inspected: 0 });
    expect(await rowsOf(id)).toMatchObject([{ lastInspectedAt: null }]);
  });

  it("reads only changes it has not recorded yet", async () => {
    await doneChange("https://battery-sensei.app/pricing");
    await syncSeoImpact();
    const read = vi.spyOn(prisma, "$queryRaw");
    try {
      await syncSeoImpact();
      expect(await read.mock.results[0]?.value).toEqual([]);
    } finally {
      read.mockRestore();
    }
  });

  it("records every change past a full batch", async () => {
    await doneChanges(projectId, 201);

    expect(await syncSeoImpact()).toMatchObject({ recorded: 201 });
  });

  it("skips eval changes before they fill a batch", async () => {
    await doneChanges(evalProjectId, 201);
    const { id } = await doneChange("https://battery-sensei.app/pricing");
    // Time for one batch only.
    let batches = 0;
    const tick = {
      shouldContinue: () => batches++ < 1,
      msRemaining: () => Number.POSITIVE_INFINITY,
    };

    await syncSeoImpact(tick);

    expect(await rowsOf(id)).toHaveLength(1);
  });

  it("stops after the batch the tick has time for, and inspects nothing", async () => {
    await doneChanges(projectId, 201);
    // Time for one batch only.
    let batches = 0;
    const tick = {
      shouldContinue: () => batches++ < 1,
      msRemaining: () => Number.POSITIVE_INFINITY,
    };

    expect(await syncSeoImpact(tick)).toMatchObject({
      inspected: 0,
      stopped: true,
    });
    expect(
      await prisma.projectSeoImpactVerdict.count({ where: { projectId } }),
    ).toBeLessThan(201);
  });

  it("skips changes with an empty page before they fill a batch", async () => {
    await doneChanges(projectId, 201, "");
    const { id } = await doneChange("https://battery-sensei.app/pricing");
    // Time for one batch only.
    let batches = 0;
    const tick = {
      shouldContinue: () => batches++ < 1,
      msRemaining: () => Number.POSITIVE_INFINITY,
    };

    await syncSeoImpact(tick);

    expect(await rowsOf(id)).toHaveLength(1);
  });

  it("inspects the other accounts' pages when one account fails", async () => {
    const { id } = await doneChange("https://battery-sensei.app/pricing");
    await syncSeoImpact();
    // The refused account's pages were never inspected, so they come first.
    await doneChanges(failingProjectId, 501);
    vi.mocked(propertyChoices).mockRejectedValueOnce(
      new Error("Composio refused the read: 403"),
    );
    expectCoreLog("warn", "SEO impact tracking could not read Search Console.");
    const later = new Date(Date.now() + 21 * HOUR_MS);

    expect(await syncSeoImpact(undefined, later)).toMatchObject({
      stopped: false,
    });
    expect(await rowsOf(id)).toMatchObject([{ lastInspectedAt: later }]);
  });

  it("fills the next page only up to the tick's inspection limit", async () => {
    await doneChanges(projectId, 500);
    await syncSeoImpact();
    // The refused account's two pages come first: one fails, one is deferred.
    await doneChanges(failingProjectId, 2);
    vi.mocked(propertyChoices).mockRejectedValueOnce(
      new Error("Composio refused the read: 403"),
    );
    expectCoreLog("warn", "SEO impact tracking could not read Search Console.");

    expect(
      await syncSeoImpact(undefined, new Date(Date.now() + 21 * HOUR_MS)),
    ).toMatchObject({ inspected: 500 });
  });

  it("defers an account's other pages when its property list fails", async () => {
    const pages = ["a", "b"].map(
      (page) => `https://battery-sensei.app/${page}`,
    );
    const changes = await Promise.all(
      pages.map((page) => doneChange(page, { status: "open" })),
    );
    // Recorded by the status writes, so the tick below only inspects.
    for (const { id } of changes)
      await updateSeoSuggestion({
        where: { id },
        data: { status: "done", doneAt: CHANGED_AT },
      });
    vi.mocked(propertyChoices).mockRejectedValueOnce(
      new Error("Composio refused the read: 403"),
    );
    expectCoreLog("warn", "SEO impact tracking could not read Search Console.");

    // Both pages are past the wait: a page counted as failed is given up.
    await syncSeoImpact(
      undefined,
      new Date(Date.now() + IMPACT_CRAWL_WAIT_DAYS * DAY_MS),
    );

    const rows = (
      await Promise.all(changes.map(({ id }) => rowsOf(id)))
    ).flat();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "not_measurable",
          reason: "inspection_failed",
        }),
        expect.objectContaining({
          state: "waiting_crawl",
          reason: null,
          lastInspectedAt: null,
        }),
      ]),
    );
    expect(propertyChoices).toHaveBeenCalledOnce();
  });

  it("starts no URL Inspection once the property lookup spent the tick", async () => {
    const { id } = await doneChange("https://battery-sensei.app/pricing");
    lastCrawl.set("https://battery-sensei.app/pricing", "2026-11-22T08:00:00Z");
    let remaining = 60_000;
    vi.mocked(propertyChoices).mockImplementationOnce(async () => {
      // Only the time kept back for the writes is left.
      remaining = 5_000;
      return {
        provider: "search_console",
        properties: properties.map((property) => ({
          id: property,
          name: property,
        })),
        status: "available",
        reason: null,
      };
    });
    const tick = {
      shouldContinue: () => true,
      msRemaining: () => remaining,
    };

    expect(await syncSeoImpact(tick)).toMatchObject({
      inspected: 0,
      stopped: true,
    });
    expect(beforeAnswer).not.toHaveBeenCalled();
    expect(await rowsOf(id)).toMatchObject([
      { state: "waiting_crawl", lastInspectedAt: null },
    ]);
  });

  it("starts no property lookup once the connection lookup spent the tick", async () => {
    const { id } = await doneChange("https://battery-sensei.app/pricing");
    let remaining = 60_000;
    const read = prisma.sokoBot.findFirst;
    const spy = vi.spyOn(prisma.sokoBot, "findFirst").mockImplementation(((
      args: Parameters<typeof read>[0],
    ) => {
      // Only the time kept back for the writes is left.
      remaining = 5_000;
      return read(args);
    }) as typeof read);
    const tick = {
      shouldContinue: () => true,
      msRemaining: () => remaining,
    };
    try {
      expect(await syncSeoImpact(tick)).toMatchObject({
        inspected: 0,
        stopped: true,
      });
    } finally {
      spy.mockRestore();
    }

    expect(propertyChoices).not.toHaveBeenCalled();
    expect(await rowsOf(id)).toMatchObject([
      { state: "waiting_crawl", lastInspectedAt: null },
    ]);
  });

  it("stores each inspection before the next one starts", async () => {
    const pages = ["a", "b"].map(
      (page) => `https://battery-sensei.app/${page}`,
    );
    const changes = await Promise.all(pages.map((page) => doneChange(page)));
    for (const page of pages) lastCrawl.set(page, "2026-11-22T08:00:00Z");
    const asked: string[] = [];
    let storedFirst: unknown;
    beforeAnswer.mockImplementation(async (pageUrl) => {
      asked.push(pageUrl);
      if (asked.length === 1) return;
      const first = changes[pages.indexOf(asked[0] ?? "")];
      storedFirst = first && (await rowsOf(first.id))[0]?.state;
      throw new Error("the tick ends here");
    });
    expectCoreLog("warn", "SEO impact tracking could not read Search Console.");

    await syncSeoImpact();

    expect(storedFirst).toBe("waiting_window");
  });

  it("stops waiting for a read that outlasts the tick, and starts no other", async () => {
    const pages = ["a", "b", "c"].map(
      (page) => `https://battery-sensei.app/${page}`,
    );
    const changes = await Promise.all(pages.map((page) => doneChange(page)));
    for (const page of pages) lastCrawl.set(page, "2026-11-22T08:00:00Z");
    const asked: string[] = [];
    beforeAnswer.mockImplementation(async (pageUrl) => {
      asked.push(pageUrl);
      if (asked.length === 2) await new Promise(() => {});
    });
    expectCoreLog("warn", "SEO impact tracking could not read Search Console.");
    // 5 s are kept back for the writes: half a second is left for the reads.
    const deadline = Date.now() + 5_500;
    const tick = {
      shouldContinue: () => Date.now() < deadline,
      msRemaining: () => Math.max(0, deadline - Date.now()),
    };

    expect(await syncSeoImpact(tick)).toMatchObject({
      crawled: 1,
      failed: 1,
      stopped: true,
    });
    expect(asked).toHaveLength(2);
    const [first, second] = asked.map((page) => changes[pages.indexOf(page)]);
    expect(await rowsOf(first?.id ?? "")).toMatchObject([
      { state: "waiting_window" },
    ]);
    expect(await rowsOf(second?.id ?? "")).toMatchObject([
      { state: "waiting_crawl", reason: "inspection_failed" },
    ]);
  });

  it("inspects a never-inspected page before one inspected again", async () => {
    const pages = ["a", "b"].map(
      (page) => `https://battery-sensei.app/${page}`,
    );
    const [first, second] = await Promise.all(
      pages.map((page) => doneChange(page)),
    );
    // One inspection slot per tick.
    let slots = 0;
    const tick = {
      shouldContinue: () => slots < 1,
      msRemaining: () => Number.POSITIVE_INFINITY,
    };
    beforeAnswer.mockImplementation(async () => {
      slots += 1;
    });

    await syncSeoImpact(tick);
    slots = 0;
    await syncSeoImpact(tick, new Date(Date.now() + DAY_MS));

    const inspected = [
      ...(await rowsOf(first.id)),
      ...(await rowsOf(second.id)),
    ].map((row) => row.lastInspectedAt);
    expect(inspected).toEqual([expect.any(Date), expect.any(Date)]);
  });

  it("asks again only after the wait between inspections, the longest-waiting page first", async () => {
    const now = new Date();
    const owner = { userId, projectId };
    for (const [page, hours] of [
      ["recent", 1],
      ["older", 21],
      ["oldest", 22],
    ] as const) {
      const { id } = await doneChange(`https://battery-sensei.app/${page}`, {
        status: "open",
      });
      await setCmoSeoSuggestionStatus(owner, id, "done", CHANGED_AT);
      await prisma.projectSeoImpactVerdict.updateMany({
        where: { suggestionId: id },
        data: { lastInspectedAt: new Date(now.getTime() - hours * HOUR_MS) },
      });
    }
    const asked: string[] = [];
    beforeAnswer.mockImplementation(async (pageUrl) => {
      asked.push(pageUrl);
    });

    // One inspection in the first tick.
    await syncSeoImpact(
      {
        shouldContinue: () => asked.length < 1,
        msRemaining: () => Number.POSITIVE_INFINITY,
      },
      now,
    );
    await syncSeoImpact(undefined, now);

    expect(asked).toEqual([
      "https://battery-sensei.app/oldest",
      "https://battery-sensei.app/older",
    ]);
  });

  it("asks Google nothing for a page that is no web URL, and ends it at once", async () => {
    const pages = await Promise.all(
      ["battery-sensei.app pricing", "ftp://battery-sensei.app/pricing"].map(
        (pageUrl) => doneChange(pageUrl),
      ),
    );

    // No later tick can find a property for it: it stops waiting now.
    expect(await syncSeoImpact()).toMatchObject({ notMeasurable: 2 });
    for (const { id } of pages)
      expect(await rowsOf(id)).toMatchObject([
        { state: "not_measurable", reason: "no_property" },
      ]);
    expect(propertyChoices).not.toHaveBeenCalled();
  });

  it("gives a page that is no URL no property, and inspects the next pages", async () => {
    const pageUrl = "https://battery-sensei.app/pricing";
    const plainPage = "http://battery-sensei.app/about";
    const noUrl = await doneChange("battery-sensei.app pricing");
    await doneChange(pageUrl);
    await doneChange(plainPage);
    lastCrawl.set(pageUrl, "2026-11-22T08:00:00Z");
    lastCrawl.set(plainPage, "2026-11-22T08:00:00Z");

    expect(await syncSeoImpact()).toMatchObject({ crawled: 2 });
    expect(await rowsOf(noUrl.id)).toMatchObject([{ reason: "no_property" }]);
  });

  it("lists the changes of the chosen period, with the day a crawled window is final", async () => {
    const pageUrl = "https://battery-sensei.app/pricing";
    await doneChange(pageUrl);
    await doneChange("https://battery-sensei.app/old", {
      doneAt: new Date(CHANGED_AT.getTime() - 100 * DAY_MS),
    });
    lastCrawl.set(pageUrl, "2026-11-22T08:00:00Z");
    await syncSeoImpact();

    const { rows, total } = await listAdminSeoImpactVerdicts(
      { period: "90" },
      new Date(CHANGED_AT.getTime() + 10 * DAY_MS),
    );
    // The count is of the same period as the rows.
    expect(total).toBe(rows.length);
    const ours = rows.filter((row) => row.projectId === projectId);
    expect(ours).toMatchObject([
      { pageUrl, windowEnd: "2026-12-24", windowReadyOn: "2026-12-31" },
    ]);
  });

  it("stores the reason of a refused inspection, then gives up after the wait", async () => {
    const pageUrl = "https://battery-sensei.app/pricing";
    const { id } = await doneChange(pageUrl);
    lastCrawl.set(pageUrl, new Error("Composio refused the read: 403"));
    expectCoreLog(
      "warn",
      "SEO impact tracking could not read Search Console.",
      2,
    );

    expect(await syncSeoImpact()).toMatchObject({ failed: 1 });
    expect(await rowsOf(id)).toMatchObject([
      { state: "waiting_crawl", reason: "inspection_failed" },
    ]);

    await syncSeoImpact(
      undefined,
      new Date(Date.now() + IMPACT_CRAWL_WAIT_DAYS * DAY_MS),
    );
    expect(await rowsOf(id)).toMatchObject([
      { state: "not_measurable", reason: "inspection_failed" },
    ]);
  });
});
