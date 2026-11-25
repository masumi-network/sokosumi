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
import { expectCoreLog } from "@/test/core-log";
import { setCmoSeoSuggestionStatus } from "./cmo-seo.service";
import { IMPACT_CRAWL_WAIT_DAYS, syncSeoImpact } from "./seo-impact.service";

/** Google's last crawl per page URL, or an Error for a refused inspection. */
const lastCrawl = new Map<string, string | Error>();

// Google is the boundary: the property list and URL Inspection are faked.
vi.mock("@/services/project-seo-statistics.service", async (original) => ({
  ...(await original<
    typeof import("@/services/project-seo-statistics.service")
  >()),
  propertyChoices: vi.fn(async () => ({
    provider: "search_console",
    properties: [
      { id: "sc-domain:battery-sensei.app", name: "battery-sensei.app" },
    ],
    status: "available",
    reason: null,
  })),
  readNativeSeoTool: vi.fn(
    async (_account: unknown, _slug: string, args: Record<string, unknown>) => {
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
const userId = randomUUID(),
  organizationId = randomUUID(),
  workspaceId = randomUUID(),
  projectId = randomUUID(),
  copyProjectId = randomUUID(),
  evalOrganizationId = randomUUID(),
  evalWorkspaceId = randomUUID(),
  evalProjectId = randomUUID(),
  evalCusoProjectId = randomUUID();
const EVAL_LANE = 9_000_000 + Math.floor(Math.random() * 1_000_000);
const env = getEnv();
const previous = env.SEO_IMPACT_TRACKING_ENABLED;

const CHANGED_AT = new Date("2026-11-20T10:00:00Z");

async function doneChange(
  pageUrl: string,
  options: { project?: string; doneAt?: Date } = {},
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
      status: "done",
      doneAt: options.doneAt ?? CHANGED_AT,
    },
    select: { id: true },
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
      ],
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
    await prisma.projectSeoSuggestion.deleteMany({
      where: {
        projectId: {
          in: [projectId, copyProjectId, evalProjectId, evalCusoProjectId],
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

  it("keeps the first row and adds a second when a reopened change is done again", async () => {
    const { id } = await doneChange("https://battery-sensei.app/pricing");
    const owner = { userId, projectId };
    const first = new Date("2026-11-21T10:00:00Z");
    const second = new Date("2026-11-23T10:00:00Z");
    await setCmoSeoSuggestionStatus(owner, id, "done", first);
    await syncSeoImpact();
    await setCmoSeoSuggestionStatus(owner, id, "open");
    await syncSeoImpact();
    await setCmoSeoSuggestionStatus(owner, id, "done", second);
    await syncSeoImpact();

    expect((await rowsOf(id)).map((row) => row.changedAt)).toEqual([
      first,
      second,
    ]);
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

  it("ignores a crawl from before the change", async () => {
    const pageUrl = "https://battery-sensei.app/pricing";
    const { id } = await doneChange(pageUrl);
    lastCrawl.set(pageUrl, "2026-11-19T08:00:00Z");

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
