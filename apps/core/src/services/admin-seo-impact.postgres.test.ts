/**
 * The admin SEO impact list against PostgreSQL: its state and source filters,
 * and the count of each state.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/admin-seo-impact.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import { listAdminSeoImpactVerdicts } from "./admin-seo-impact";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const DAY_MS = 86_400_000;
// Far after every other suite's changes: a 90-day period shows only these rows.
const NOW = new Date("2099-06-01T00:00:00Z");
const organizationId = `admin-seo-impact-${randomUUID()}`;
const workspaceId = randomUUID();
const projectId = randomUUID();

const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

describe.skipIf(!enabled)("admin SEO impact list against PostgreSQL", () => {
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
      data: {
        id: projectId,
        workspaceId,
        name: "Cuso",
        websiteUrl: "https://battery-sensei.app/",
      },
    });
    await prisma.projectSeoImpactVerdict.createMany({
      data: [
        ["cuso_done", "measured", 1],
        ["cuso_done", "measured", 2],
        ["cuso_done", "waiting_crawl", 3],
        ["audit_recheck", "measured", 4],
        ["audit_recheck", "not_measurable", 5],
        // Outside the 90-day period.
        ["cuso_done", "measured", 120],
      ].map(([changeSource, state, days], index) => ({
        projectId,
        changeSource: String(changeSource),
        state: String(state),
        changedAt: daysAgo(Number(days)),
        pageUrl: `https://battery-sensei.app/page-${index}`,
      })),
    });
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { workspaceId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  const countsOf = (counts: { state: string; count: number }[]) =>
    Object.fromEntries(counts.map(({ state, count }) => [state, count]));

  it("counts every state of the period and source, also while one state is picked", async () => {
    const all = await listAdminSeoImpactVerdicts({ period: "90" }, NOW);
    expect(all.total).toBe(5);
    expect(all.rows).toHaveLength(5);
    expect(countsOf(all.counts)).toEqual({
      waiting_crawl: 1,
      waiting_window: 0,
      ready: 0,
      waiting_retry: 0,
      measured: 3,
      not_measurable: 1,
    });

    const measured = await listAdminSeoImpactVerdicts(
      { period: "90", state: "measured" },
      NOW,
    );
    expect(measured.total).toBe(3);
    expect(measured.rows.map((row) => row.state)).toEqual([
      "measured",
      "measured",
      "measured",
    ]);
    expect(measured.counts).toEqual(all.counts);
  });

  it("narrows rows, total and counts to one source", async () => {
    const recheck = await listAdminSeoImpactVerdicts(
      { period: "90", source: "audit_recheck" },
      NOW,
    );
    expect(recheck.total).toBe(2);
    expect(recheck.rows.map((row) => row.changeSource)).toEqual([
      "audit_recheck",
      "audit_recheck",
    ]);
    expect(countsOf(recheck.counts)).toMatchObject({
      measured: 1,
      not_measurable: 1,
      waiting_crawl: 0,
    });

    const both = await listAdminSeoImpactVerdicts(
      { period: "365", source: "cuso_done", state: "measured" },
      NOW,
    );
    expect(both.total).toBe(3);
    expect(both.rows.map((row) => [row.changeSource, row.state])).toEqual([
      ["cuso_done", "measured"],
      ["cuso_done", "measured"],
      ["cuso_done", "measured"],
    ]);
  });
});
