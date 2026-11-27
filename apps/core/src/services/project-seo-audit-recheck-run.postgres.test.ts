/**
 * The audit recheck against PostgreSQL: a newer audit marks an earlier action done and tracks its page.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/project-seo-audit-recheck-run.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getEnv } from "@/config/env";
import type { PublicSeoPayload } from "@/helpers/project-seo-report";
import prisma from "@/lib/db/prisma";

import { recheckSeoAudit } from "./project-seo-audit-recheck-run";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const env = getEnv();
const previous = env.SEO_IMPACT_TRACKING_ENABLED;
const organizationId = randomUUID(),
  workspaceId = randomUUID(),
  projectId = randomUUID();
const PAGE = "https://battery-sensei.app/pricing";
const BEFORE = new Date("2026-11-01T09:00:00.000Z");
const AFTER = new Date("2026-11-09T09:00:00.000Z");

/** A stored audit of PAGE whose title rule fired or passed. */
async function audit(observedAt: Date, result: "fired" | "pass") {
  const check = {
    rowId: "title",
    pageUrl: PAGE,
    device: "mobile" as const,
    result,
    ruleKey: "0123456789abcdef",
    pageOnly: true as const,
    finalUrl: PAGE,
  };
  const fired = result === "fired";
  const payload: PublicSeoPayload = {
    version: 1,
    kind: "audit_full",
    requestId: null,
    pageUrls: [PAGE],
    observedAt: observedAt.toISOString(),
    countryCode: "US",
    languageCode: "en",
    rulebookVersion: "r1",
    checks: [check],
    keywords: [],
    competitors: [],
    findings: fired
      ? [
          {
            id: "f1:mobile",
            pageUrl: PAGE,
            device: "mobile",
            rowId: "title",
            title: "The title misses the app name",
            severity: "major",
            evidence: [],
            sourceRef: "snapshot",
            observedAt: observedAt.toISOString(),
          },
        ]
      : [],
    actions: fired
      ? [
          {
            id: "1",
            pageUrl: PAGE,
            findingIds: ["f1:mobile"],
            title: "Name the app in the title",
            why: "Searchers look for it by name.",
            effort: "low",
            expectedEffect: "More clicks",
            edit: null,
          },
        ]
      : [],
    coverage: { checked: 1, skipped: 0, failed: 0 },
    notes: [],
  };
  return await prisma.projectSeoObservation.create({
    data: {
      projectId,
      kind: "audit_full",
      source: "seo_coworker",
      sourceKey: `test:${randomUUID()}`,
      artifactHash: randomUUID(),
      payload,
      observedAt,
    },
  });
}

const verdicts = () =>
  prisma.projectSeoImpactVerdict.findMany({ where: { projectId } });
const statuses = () =>
  prisma.projectSeoAuditActionStatus.findMany({
    where: { observation: { projectId } },
  });

describe.skipIf(!enabled)("SEO audit recheck against PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: organizationId,
        slug: organizationId,
        name: "battery-sensei.app",
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.project.create({
      data: { id: projectId, workspaceId, name: "Cuso" },
    });
  });

  beforeEach(async () => {
    env.SEO_IMPACT_TRACKING_ENABLED = true;
    await prisma.projectSeoObservation.deleteMany({ where: { projectId } });
    await prisma.projectSeoImpactVerdict.deleteMany({ where: { projectId } });
  });

  afterAll(async () => {
    env.SEO_IMPACT_TRACKING_ENABLED = previous;
    await prisma.project.deleteMany({ where: { workspaceId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  it("marks the action done and tracks the page once", async () => {
    const earlier = await audit(BEFORE, "fired");
    const next = await audit(AFTER, "pass");

    await recheckSeoAudit(next.id);
    await recheckSeoAudit(next.id);

    expect(await statuses()).toMatchObject([
      {
        observationId: earlier.id,
        actionId: "1",
        status: "done",
        checkedObservationId: next.id,
        closedAt: AFTER,
      },
    ]);
    expect(await verdicts()).toMatchObject([
      {
        changeSource: "audit_recheck",
        suggestionId: null,
        pageUrl: PAGE,
        changedAt: BEFORE,
        changeEarliest: BEFORE,
        changeLatest: AFTER,
        recheckAuditId: next.id,
        state: "waiting_crawl",
        closingEvidence: [
          {
            observationId: earlier.id,
            actionId: "1",
            rowId: "title",
            device: "mobile",
            ruleKey: "0123456789abcdef",
            finalUrl: PAGE,
            baselineObservationId: earlier.id,
            checkedObservationId: next.id,
          },
        ],
      },
    ]);
  });

  it("changes nothing for an audit older than the newest one", async () => {
    await audit(BEFORE, "fired");
    const late = await audit(new Date("2026-11-05T09:00:00.000Z"), "pass");
    await audit(AFTER, "fired");

    await recheckSeoAudit(late.id);

    expect(await statuses()).toEqual([]);
    expect(await verdicts()).toEqual([]);
  });

  it("leaves the page to Cuso's own record of a change in the span", async () => {
    await audit(BEFORE, "fired");
    const next = await audit(AFTER, "pass");
    await prisma.projectSeoImpactVerdict.create({
      data: {
        projectId,
        changeSource: "cuso_done",
        changedAt: new Date("2026-11-04T09:00:00.000Z"),
        pageUrl: PAGE,
      },
    });

    await recheckSeoAudit(next.id);

    expect(await statuses()).toMatchObject([{ status: "done" }]);
    expect(await verdicts()).toMatchObject([{ changeSource: "cuso_done" }]);
  });

  it("tracks no page while impact tracking is off", async () => {
    env.SEO_IMPACT_TRACKING_ENABLED = false;
    await audit(BEFORE, "fired");
    const next = await audit(AFTER, "pass");

    await recheckSeoAudit(next.id);

    expect(await statuses()).toMatchObject([{ status: "done" }]);
    expect(await verdicts()).toEqual([]);
  });
});
