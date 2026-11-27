/**
 * The SEO impact queue against PostgreSQL: Core prepares the worker's input
 * for a change whose window is final, the worker claims it and posts its
 * verdict.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/seo-impact-queue.postgres.test.ts
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
import { impactWindow } from "@/lib/seo/impact-window";
import type { SeoImpactInput } from "@/schemas/seo-impact-worker.schema";
import { readNativeSeoTool } from "@/services/project-seo-statistics.service";
import { expectCoreLog } from "@/test/core-log";
import fixture from "@/test-fixtures/seo-impact-verdict.json";

import {
  claimSeoImpact,
  recordSeoImpactVerdict,
  SEO_IMPACT_CLAIM_MS,
  SEO_IMPACT_MAX_CLAIMS,
} from "./seo-impact-claims";
import { prepareSeoImpactInputs } from "./seo-impact-prepare";

const DAY_MS = 86_400_000;
const SITE = "https://battery-sensei.app";
const PAGE = `${SITE}/pricing`;
const CHANGED_AT = new Date("2026-09-01T10:00:00.000Z");
const CRAWLED_AT = new Date("2026-09-03T08:00:00.000Z");
const NOW = new Date("2026-11-20T12:00:00.000Z");
const CHANGE_DAY = "2026-09-01";

const dayIndex = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/** A page's impressions on a day: Google's numbers, as the fake answers them. */
const traffic = new Map<string, (date: string) => number>();
const flat = (impressions: number) => () => impressions;

// Google is the boundary: each Search Analytics read answers from `traffic`.
vi.mock("@/services/project-seo-statistics.service", async (original) => ({
  ...(await original<
    typeof import("@/services/project-seo-statistics.service")
  >()),
  readNativeSeoTool: vi.fn(
    async (_account: unknown, _slug: string, args: Record<string, unknown>) => {
      const from = dayIndex(String(args.start_date));
      const to = dayIndex(String(args.end_date));
      const days = Array.from({ length: to - from + 1 }, (_, index) =>
        new Date((from + index) * DAY_MS).toISOString().slice(0, 10),
      );
      const row = (keys: string[], impressions: number) => {
        const clicks = Math.floor(impressions / 7);
        // Google rounds CTR: Core must compute its own.
        const ctr = impressions
          ? Math.round((clicks / impressions) * 1000) / 1000
          : 0;
        return { keys, clicks, impressions, ctr, position: 3.2 };
      };
      const filter = (
        args.dimension_filter_groups as
          | { filters: { expression: string }[] }[]
          | undefined
      )?.[0]?.filters[0]?.expression;
      const dimensions = args.dimensions as string[];
      if (dimensions[0] === "page")
        return {
          successful: true,
          data: {
            rows: [...traffic].map(([page, of]) =>
              row(
                [page],
                days.reduce((sum, day) => sum + of(day), 0),
              ),
            ),
          },
        };
      const of = filter
        ? (traffic.get(filter) ?? flat(0))
        : (day: string) =>
            [...traffic.values()].reduce((sum, page) => sum + page(day), 0);
      return {
        successful: true,
        data: {
          rows: days
            .filter((day) => of(day) > 0)
            .map((day) => row([day], of(day))),
        },
      };
    },
  ),
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const env = getEnv();
const previous = {
  tracking: env.SEO_IMPACT_TRACKING_ENABLED,
  dispatch: env.SEO_IMPACT_DISPATCH_ENABLED,
};
const userId = randomUUID(),
  organizationId = randomUUID(),
  workspaceId = randomUUID(),
  projectId = randomUUID();
const tick = { shouldContinue: () => true, msRemaining: () => 60_000 };

/** A verified done change whose window Search Console has settled by NOW. */
async function finalChange(
  options: {
    pageUrl?: string;
    measuredUrl?: string | null;
    doneAgainAt?: Date;
    status?: string;
  } = {},
) {
  const pageUrl = options.pageUrl ?? PAGE;
  const suggestion = await prisma.projectSeoSuggestion.create({
    data: {
      projectId,
      kind: "page_change",
      key: `test:${randomUUID()}`,
      source: "cuso",
      title: "Name the battery app in the title",
      pageUrl,
      why: "Searchers look for the app by name.",
      body: "Put the app name first.",
      evidence: [],
      status: options.status ?? "verified",
      doneAt: options.doneAgainAt ?? CHANGED_AT,
      verifiedAt: NOW,
    },
  });
  const window = impactWindow(CHANGED_AT, CRAWLED_AT);
  return await prisma.projectSeoImpactVerdict.create({
    data: {
      projectId,
      changeSource: "cuso_done",
      suggestionId: suggestion.id,
      changedAt: CHANGED_AT,
      pageUrl,
      property: "sc-domain:battery-sensei.app",
      state: "waiting_window",
      crawledAt: CRAWLED_AT,
      // Each crawl since this PR keeps it: null only on an older row.
      measuredUrl:
        options.measuredUrl === undefined ? pageUrl : options.measuredUrl,
      windowStart: new Date(`${window.windowStart}T00:00:00Z`),
      windowEnd: new Date(`${window.windowEnd}T00:00:00Z`),
    },
  });
}

/** The worker's result for an input: the fixture's numbers, this input's header. */
function resultFor(input: SeoImpactInput, state = "tested") {
  return {
    ...fixture.result,
    impactId: input.impactId,
    pageUrl: input.pageUrl,
    property: input.property,
    changedAt: input.changedAt,
    changeSource: input.changeSource,
    observedAt: input.readAt,
    windowCrawl: input.windowCrawl,
    state,
    ...(state === "waiting" ? { verdict: null, retryAfter: "2026-12-01" } : {}),
  } as Parameters<typeof recordSeoImpactVerdict>[1];
}

const rowOf = (id: string) =>
  prisma.projectSeoImpactVerdict.findUniqueOrThrow({ where: { id } });

describe.skipIf(!enabled)("SEO impact queue against PostgreSQL", () => {
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
    await prisma.organization.create({
      data: {
        id: organizationId,
        slug: organizationId,
        name: "battery-sensei.app",
        workspace: { create: { id: workspaceId } },
        members: {
          create: { userId, role: "owner", seatAssignedAt: new Date() },
        },
      },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        workspaceId,
        name: "Cuso",
        websiteUrl: `${SITE}/`,
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
  });

  beforeEach(async () => {
    env.SEO_IMPACT_TRACKING_ENABLED = true;
    env.SEO_IMPACT_DISPATCH_ENABLED = true;
    // Reset, not clear: a once-value a failed test left must not reach the next.
    vi.mocked(readNativeSeoTool).mockReset();
    traffic.clear();
    traffic.set(PAGE, flat(70));
    await prisma.projectSeoSuggestion.deleteMany({ where: { projectId } });
  });

  afterAll(async () => {
    env.SEO_IMPACT_TRACKING_ENABLED = previous.tracking;
    env.SEO_IMPACT_DISPATCH_ENABLED = previous.dispatch;
    await prisma.sokoBot.deleteMany({ where: { workspaceId } });
    await prisma.project.deleteMany({ where: { workspaceId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("prepares nothing while dispatch is off", async () => {
    env.SEO_IMPACT_DISPATCH_ENABLED = false;
    const change = await finalChange();

    expect(await prepareSeoImpactInputs(tick, NOW)).toMatchObject({
      skipped: "disabled",
    });
    expect((await rowOf(change.id)).state).toBe("waiting_window");
  });

  it("serves no ready change while dispatch is off", async () => {
    const change = await finalChange();
    await prepareSeoImpactInputs(tick, NOW);
    env.SEO_IMPACT_DISPATCH_ENABLED = false;

    expect(await claimSeoImpact(NOW)).toBeNull();
    expect(await rowOf(change.id)).toMatchObject({
      state: "ready",
      claimId: null,
      attempts: 0,
    });
  });

  it("prepares a final window, one of two claims takes it, and its verdict measures it", async () => {
    // Five pages beat the spiking one before the change: only after it
    // does that page lead. Another origin and a tracked page never count,
    // also in a spelling the worker reads as the same page.
    for (const page of ["a", "b", "c", "d", "e"])
      traffic.set(`${SITE}/${page}`, flat(30));
    traffic.set(`${SITE}/spike`, (day) => (day < CHANGE_DAY ? 1 : 5_000));
    traffic.set("https://other.example/top", flat(900));
    traffic.set(`${SITE}/~tracked`, flat(900));
    traffic.set(`${PAGE}#pricing-table`, flat(900));
    traffic.set(`${PAGE}?`, flat(900));
    // The worker echoes a lowercased host: Core serves that form.
    const change = await finalChange({
      pageUrl: PAGE.replace("battery", "Battery"),
    });
    await finalChange({ pageUrl: `${SITE}/%7Etracked` });

    expect(await prepareSeoImpactInputs(tick, NOW)).toMatchObject({
      prepared: 2,
      failed: 0,
    });
    const claims = await Promise.all([
      claimSeoImpact(NOW),
      claimSeoImpact(NOW),
    ]);
    const won = claims.filter((claim) => claim !== null);
    expect(won).toHaveLength(2);
    expect(new Set(won.map((claim) => claim.input.impactId)).size).toBe(2);
    const claim = won.find((c) => c.input.impactId === change.id)!;
    const { input } = claim;
    expect(input).toMatchObject({
      pageUrl: PAGE,
      changeCheck: "verified",
      windowCrawl: CRAWLED_AT.toISOString(),
      readAt: NOW.toISOString(),
    });
    expect(input.candidates.map((c) => c.pageUrl).sort()).toEqual(
      ["a", "b", "c", "d", "e"].map((page) => `${SITE}/${page}`),
    );
    const day = input.pageByDate[0]!;
    expect(day.ctr).toBe(day.clicks / day.impressions);
    expect(input.pageByDate.at(-1)?.date).toBe("2026-11-17");
    expect(await claimSeoImpact(NOW)).toBeNull();

    const result = resultFor(input);
    const receipt = { impactId: change.id, state: "tested" };
    expect(await recordSeoImpactVerdict(claim.claimId, result, NOW)).toEqual(
      receipt,
    );
    // The worker lost the reply and posts the same result again.
    expect(await recordSeoImpactVerdict(claim.claimId, result, NOW)).toEqual(
      receipt,
    );
    await expect(
      recordSeoImpactVerdict(
        claim.claimId,
        { ...result, verdict: { verdict: "no effect detected" } },
        NOW,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await rowOf(change.id)).toMatchObject({
      state: "measured",
      verdictAt: NOW,
      claimedUntil: null,
      attempts: 1,
    });
  });

  it.each([
    ["impactId", randomUUID()],
    ["pageUrl", `${SITE}/other`],
    ["property", "sc-domain:other.example"],
    ["changedAt", CRAWLED_AT.toISOString()],
    ["changeSource", "audit_recheck"],
    ["windowCrawl", NOW.toISOString()],
    ["observedAt", CRAWLED_AT.toISOString()],
  ])("refuses a result with another %s", async (field, value) => {
    const change = await finalChange();
    await prepareSeoImpactInputs(tick, NOW);
    const claim = (await claimSeoImpact(NOW))!;

    await expect(
      recordSeoImpactVerdict(
        claim.claimId,
        { ...resultFor(claim.input), [field]: value },
        NOW,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect((await rowOf(change.id)).state).toBe("ready");
  });

  it("keeps the pin of a waiting result for the next read", async () => {
    const change = await finalChange();
    await prepareSeoImpactInputs(tick, NOW);
    const claim = (await claimSeoImpact(NOW))!;

    expect(
      await recordSeoImpactVerdict(
        claim.claimId,
        resultFor(claim.input, "waiting"),
        NOW,
      ),
    ).toEqual({ impactId: change.id, state: "waiting" });
    expect(await rowOf(change.id)).toMatchObject({
      state: "waiting_retry",
      waits: 1,
      claimedUntil: null,
      verdict: expect.objectContaining({
        retryAfter: "2026-12-01",
        comparison: expect.objectContaining({
          pageUrl: fixture.result.comparison.pageUrl,
        }),
      }),
    });
  });

  describe("a waiting result", () => {
    const CONTROL = `${SITE}/control`;
    // 23:00 on 2026-11-30 and 00:00 on 2026-12-01 in Pacific time.
    const DAY_BEFORE = new Date("2026-12-01T07:00:00.000Z");
    const RETRY_DAY = new Date("2026-12-01T08:00:00.000Z");

    /** A change whose worker waits until 2026-12-01, with CONTROL as its comparison page. */
    async function waitingChange() {
      // Five pages outrank the control page: only the pin keeps it a candidate.
      for (const page of ["a", "b", "c", "d", "e"])
        traffic.set(`${SITE}/${page}`, flat(30));
      traffic.set(CONTROL, flat(10));
      const change = await finalChange();
      await prepareSeoImpactInputs(tick, NOW);
      const claim = (await claimSeoImpact(NOW))!;
      await recordSeoImpactVerdict(
        claim.claimId,
        {
          ...resultFor(claim.input, "waiting"),
          comparison: { ...fixture.result.comparison, pageUrl: CONTROL },
        },
        NOW,
      );
      return change;
    }

    it("is read again on its retry day, with its comparison page pinned", async () => {
      const change = await waitingChange();

      expect(await prepareSeoImpactInputs(tick, DAY_BEFORE)).toMatchObject({
        prepared: 0,
      });
      expect((await rowOf(change.id)).state).toBe("waiting_retry");
      expect(await prepareSeoImpactInputs(tick, RETRY_DAY)).toMatchObject({
        prepared: 1,
        failed: 0,
      });
      expect(await rowOf(change.id)).toMatchObject({
        state: "ready",
        claimId: null,
        attempts: 0,
      });
      const claim = (await claimSeoImpact(RETRY_DAY))!;
      expect(claim.input).toMatchObject({
        impactId: change.id,
        readAt: RETRY_DAY.toISOString(),
        pin: { comparisonPage: CONTROL },
      });
      expect(claim.input.candidates.map((c) => c.pageUrl)).toContain(CONTROL);
      expect(claim.input.candidates).toHaveLength(5);

      await recordSeoImpactVerdict(
        claim.claimId,
        resultFor(claim.input),
        RETRY_DAY,
      );
      expect(await rowOf(change.id)).toMatchObject({
        state: "measured",
        waits: 1,
        verdictAt: RETRY_DAY,
      });
    });

    it("drops the pin of a comparison page that has a tracked change since", async () => {
      const change = await waitingChange();
      await finalChange({ pageUrl: CONTROL });
      await prisma.projectSeoImpactVerdict.updateMany({
        where: { projectId, pageUrl: CONTROL },
        data: { state: "measured" },
      });

      await prepareSeoImpactInputs(tick, RETRY_DAY);
      const claim = (await claimSeoImpact(RETRY_DAY))!;
      expect(claim.input).toMatchObject({ impactId: change.id, pin: null });
      expect(claim.input.candidates.map((c) => c.pageUrl)).not.toContain(
        CONTROL,
      );
    });
  });

  it.each(["change not confirmed", "not crawled after change"])(
    "measures a change on the final state %s",
    async (state) => {
      const change = await finalChange();
      await prepareSeoImpactInputs(tick, NOW);
      const claim = (await claimSeoImpact(NOW))!;

      await recordSeoImpactVerdict(
        claim.claimId,
        { ...resultFor(claim.input, state), verdict: null, retryAfter: null },
        NOW,
      );
      expect(await rowOf(change.id)).toMatchObject({
        state: "measured",
        waits: 0,
        verdictAt: NOW,
      });
    },
  );

  it("saves the verdict of a claim that ended while no later claim took it", async () => {
    const change = await finalChange();
    await prepareSeoImpactInputs(tick, NOW);
    const claim = (await claimSeoImpact(NOW))!;
    const late = new Date(NOW.getTime() + SEO_IMPACT_CLAIM_MS + 1);

    expect(
      await recordSeoImpactVerdict(claim.claimId, resultFor(claim.input), late),
    ).toEqual({ impactId: change.id, state: "tested" });
    expect((await rowOf(change.id)).state).toBe("measured");
  });

  it("lets a later claim take an ended one, and ends the change after three", async () => {
    const change = await finalChange();
    await prepareSeoImpactInputs(tick, NOW);
    let at = NOW;
    const first = (await claimSeoImpact(at))!;
    expect((await rowOf(change.id)).claimedUntil?.getTime()).toBe(
      at.getTime() + SEO_IMPACT_CLAIM_MS,
    );
    at = new Date(at.getTime() + SEO_IMPACT_CLAIM_MS);
    const second = (await claimSeoImpact(at))!;
    expect(second.claimId).not.toBe(first.claimId);
    await expect(
      recordSeoImpactVerdict(first.claimId, resultFor(first.input), at),
    ).rejects.toMatchObject({ status: 404 });
    at = new Date(at.getTime() + SEO_IMPACT_CLAIM_MS);
    const third = (await claimSeoImpact(at))!;
    at = new Date(at.getTime() + SEO_IMPACT_CLAIM_MS);

    expect(await claimSeoImpact(at)).toBeNull();
    expect(await rowOf(change.id)).toMatchObject({
      state: "not_measurable",
      reason: "worker_failed",
      attempts: 3,
    });
    await expect(
      recordSeoImpactVerdict(third.claimId, resultFor(third.input), at),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("ends a change with its last claim used and no claim running", async () => {
    const change = await finalChange();
    await prepareSeoImpactInputs(tick, NOW);
    await prisma.projectSeoImpactVerdict.update({
      where: { id: change.id },
      data: { attempts: SEO_IMPACT_MAX_CLAIMS, claimedUntil: null },
    });

    expect(await claimSeoImpact(NOW)).toBeNull();
    expect(await rowOf(change.id)).toMatchObject({
      state: "not_measurable",
      reason: "worker_failed",
    });
  });

  it("leaves the last claim running until it ends", async () => {
    const change = await finalChange();
    await prepareSeoImpactInputs(tick, NOW);
    await prisma.projectSeoImpactVerdict.update({
      where: { id: change.id },
      data: {
        attempts: SEO_IMPACT_MAX_CLAIMS,
        claimedUntil: new Date(NOW.getTime() + SEO_IMPACT_CLAIM_MS),
      },
    });

    expect(await claimSeoImpact(NOW)).toBeNull();
    expect(await rowOf(change.id)).toMatchObject({
      state: "ready",
      reason: null,
    });
  });

  it("keeps a change measured on its last claim", async () => {
    const change = await finalChange();
    await prepareSeoImpactInputs(tick, NOW);
    await prisma.projectSeoImpactVerdict.update({
      where: { id: change.id },
      data: { attempts: SEO_IMPACT_MAX_CLAIMS - 1 },
    });
    const claim = (await claimSeoImpact(NOW))!;
    await recordSeoImpactVerdict(claim.claimId, resultFor(claim.input), NOW);

    expect(await claimSeoImpact(NOW)).toBeNull();
    expect(await rowOf(change.id)).toMatchObject({
      state: "measured",
      attempts: SEO_IMPACT_MAX_CLAIMS,
    });
  });

  it("answers a replay of a saved verdict after its input stopped parsing", async () => {
    await finalChange();
    await prepareSeoImpactInputs(tick, NOW);
    const claim = (await claimSeoImpact(NOW))!;
    const result = resultFor(claim.input);
    const receipt = await recordSeoImpactVerdict(claim.claimId, result, NOW);
    await prisma.projectSeoImpactVerdict.update({
      where: { id: claim.input.impactId },
      data: { input: { ...claim.input, pageUrl: "not a url" } },
    });

    expect(await recordSeoImpactVerdict(claim.claimId, result, NOW)).toEqual(
      receipt,
    );
  });

  it("answers 409 to a verdict whose input no longer parses", async () => {
    await finalChange();
    await prepareSeoImpactInputs(tick, NOW);
    const claim = (await claimSeoImpact(NOW))!;
    await prisma.projectSeoImpactVerdict.update({
      where: { id: claim.input.impactId },
      data: { input: { ...claim.input, pageUrl: "not a url" } },
    });

    await expect(
      recordSeoImpactVerdict(claim.claimId, resultFor(claim.input), NOW),
    ).rejects.toMatchObject({ status: 409 });
  });

  // A change crawled before Core kept its measured URL would ask Google for it.
  it.each([
    ["measured", PAGE],
    ["crawled before Core kept its URL", null],
  ])(
    "serves a %s change that was done again later as unconfirmed, without Search Console",
    async (_, measuredUrl) => {
      const change = await finalChange({
        measuredUrl,
        doneAgainAt: new Date(CHANGED_AT.getTime() + 7 * DAY_MS),
      });
      const integration = { sokoBot: { workspaceId } };
      await prisma.sokoBotIntegration.updateMany({
        where: integration,
        data: { status: "REVOKED" },
      });
      try {
        await prepareSeoImpactInputs(tick, NOW);
        const claim = (await claimSeoImpact(NOW))!;

        expect(claim.input).toMatchObject({
          impactId: change.id,
          pageUrl: PAGE,
          changeCheck: "not_checked",
          pageByDate: [],
          candidates: [],
        });
        expect(readNativeSeoTool).not.toHaveBeenCalled();
      } finally {
        await prisma.sokoBotIntegration.updateMany({
          where: integration,
          data: { status: "ACTIVE" },
        });
      }
    },
  );

  it.each([
    ["verified", "done", { status: "verified" }, "verified"],
    [
      "done again",
      "verified",
      { doneAt: new Date(CHANGED_AT.getTime() + DAY_MS) },
      "not_checked",
    ],
  ])(
    "prepares a change %s during the Google reads on the next tick",
    async (_, status, update, changeCheck) => {
      await finalChange();
      const late = await finalChange({ status });
      const read = vi.mocked(readNativeSeoTool).getMockImplementation()!;
      vi.mocked(readNativeSeoTool).mockImplementationOnce(async (...args) => {
        await prisma.projectSeoSuggestion.update({
          where: { id: late.suggestionId! },
          data: update,
        });
        return await read(...args);
      });

      expect(await prepareSeoImpactInputs(tick, NOW)).toMatchObject({
        prepared: 1,
      });
      expect((await rowOf(late.id)).state).toBe("waiting_window");
      await prepareSeoImpactInputs(tick, NOW);
      expect((await rowOf(late.id)).input).toMatchObject({ changeCheck });
    },
  );

  it("sends a change stored under older rules back to be prepared, and serves the next one", async () => {
    const stale = await finalChange();
    const change = await finalChange();
    await prepareSeoImpactInputs(tick, NOW);
    // An earlier window: the claims reach the stale change first.
    await prisma.projectSeoImpactVerdict.update({
      where: { id: stale.id },
      data: { windowEnd: new Date(stale.windowEnd!.getTime() - DAY_MS) },
    });
    const ended = (await claimSeoImpact(NOW))!;
    const stored = await rowOf(stale.id);
    // A field the schema checks inside its other checks too.
    await prisma.projectSeoImpactVerdict.update({
      where: { id: stale.id },
      data: {
        input: { ...(stored.input as object), pageUrl: "not a url" },
      },
    });
    const at = new Date(NOW.getTime() + SEO_IMPACT_CLAIM_MS);

    expect((await claimSeoImpact(at))?.input.impactId).toBe(change.id);
    expect(await rowOf(stale.id)).toMatchObject({
      state: "waiting_window",
      input: null,
      claimId: null,
      claimedUntil: null,
      attempts: 0,
    });
    await expect(
      recordSeoImpactVerdict(ended.claimId, resultFor(ended.input), at),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("reads the page and its candidates where Google reports them: the www alias", async () => {
    const www = "https://www.battery-sensei.app";
    traffic.clear();
    traffic.set(`${www}/pricing`, flat(70));
    traffic.set(`${www}/about`, flat(30));
    // Under the apex host, Google reports nothing for this site.
    traffic.set(`${SITE}/old`, flat(900));
    await finalChange({ measuredUrl: `${www}/pricing` });
    await prepareSeoImpactInputs(tick, NOW);

    const { input } = (await claimSeoImpact(NOW))!;
    expect(input.pageUrl).toBe(`${www}/pricing`);
    expect(input.pageByDate.length).toBeGreaterThan(0);
    expect(input.candidates.map((c) => c.pageUrl)).toEqual([`${www}/about`]);
  });

  // Core keeps the page itself as measured where Google confirms no alias.
  it.each([
    ["crawled before Core kept its URL", null],
    ["measured where Google confirmed no alias", `${SITE}/about`],
  ])(
    "keeps a tracked page %s out of the candidates under its www alias",
    async (_, measuredUrl) => {
      const www = "https://www.battery-sensei.app";
      traffic.clear();
      traffic.set(`${www}/pricing`, flat(70));
      traffic.set(`${www}/about`, flat(900));
      traffic.set(`${www}/faq`, flat(30));
      await finalChange({ measuredUrl: `${www}/pricing` });
      const about = await finalChange({
        pageUrl: `${SITE}/about`,
        measuredUrl,
      });
      // Its window is not final yet: only the /pricing change is prepared.
      await prisma.projectSeoImpactVerdict.update({
        where: { id: about.id },
        data: { windowEnd: new Date("2027-01-01T00:00:00Z") },
      });

      await prepareSeoImpactInputs(tick, NOW);
      const { input } = (await claimSeoImpact(NOW))!;
      expect(input.candidates.map((c) => c.pageUrl)).toEqual([`${www}/faq`]);
    },
  );

  it("asks Google for the www alias of a change crawled before Core kept it", async () => {
    const www = "https://www.battery-sensei.app";
    traffic.clear();
    traffic.set(`${www}/pricing`, flat(70));
    const change = await finalChange({ measuredUrl: null });
    vi.mocked(readNativeSeoTool).mockResolvedValueOnce({
      successful: true,
      data: {
        inspectionResult: {
          indexStatusResult: {
            verdict: "PASS",
            googleCanonical: `${www}/pricing`,
            userCanonical: `${www}/pricing`,
          },
        },
      },
    });

    await prepareSeoImpactInputs(tick, NOW);
    expect(await rowOf(change.id)).toMatchObject({
      state: "ready",
      measuredUrl: `${www}/pricing`,
      crawledAt: CRAWLED_AT,
      input: expect.objectContaining({ pageUrl: `${www}/pricing` }),
    });
  });

  it("starts no Google read once the connection lookup used up the budget", async () => {
    const change = await finalChange({ measuredUrl: null });
    // Time left when the loop takes the change; the write reserve has begun
    // when the connection lookup returns.
    const late = {
      shouldContinue: () => true,
      msRemaining: vi.fn().mockReturnValueOnce(60_000).mockReturnValue(4_000),
    };
    expectCoreLog("warn", "SEO impact tracking could not prepare a change");

    expect(await prepareSeoImpactInputs(late, NOW)).toMatchObject({
      prepared: 0,
      failed: 1,
    });
    // A read started past the deadline runs on after the timeout: let it start.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(readNativeSeoTool).not.toHaveBeenCalled();
    expect((await rowOf(change.id)).state).toBe("waiting_window");
  });

  it("leaves a change waiting when Search Console answers no report", async () => {
    const change = await finalChange();
    vi.mocked(readNativeSeoTool).mockResolvedValueOnce({
      successful: true,
      data: { status: "ok" },
    });
    expectCoreLog("warn", "SEO impact tracking could not prepare a change");

    expect(await prepareSeoImpactInputs(tick, NOW)).toMatchObject({
      prepared: 0,
      failed: 1,
    });
    expect(await rowOf(change.id)).toMatchObject({
      state: "waiting_window",
      input: null,
    });
  });

  it("leaves a change waiting when a Search Console read fails", async () => {
    const change = await finalChange();
    vi.mocked(readNativeSeoTool).mockRejectedValueOnce(new Error("refused"));
    const warnings = expectCoreLog(
      "warn",
      "SEO impact tracking could not prepare a change",
    );

    expect(await prepareSeoImpactInputs(tick, NOW)).toMatchObject({
      prepared: 0,
      failed: 1,
    });
    expect(await rowOf(change.id)).toMatchObject({
      state: "waiting_window",
      input: null,
    });
    expect(warnings[0]?.event.operation).toBe("seo_impact_prepare");
  });
});
