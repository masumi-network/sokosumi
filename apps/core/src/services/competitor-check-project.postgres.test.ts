import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readers = vi.hoisted(() => ({
  readCompetitorPage: vi.fn(),
  searchExa: vi.fn(),
  startCmoTurn: vi.fn(),
}));
vi.mock("@/config/env", async (original) => {
  const actual = await original<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      EXA_API_KEY: "test-key",
      META_AD_LIBRARY_ACCESS_TOKEN: undefined,
    }),
  };
});
vi.mock("@/lib/competitors/page-read", async (original) => ({
  ...(await original<typeof import("@/lib/competitors/page-read")>()),
  readCompetitorPage: readers.readCompetitorPage,
}));
vi.mock("@/lib/soko-bot/exa", () => ({ searchExa: readers.searchExa }));
vi.mock("@/lib/competitors/model", () => ({ askCompetitorModel: vi.fn() }));
vi.mock("@/helpers/cuso-low-credit-notification", () => ({
  notifyCusoLowCreditsAfterCharge: vi.fn(),
}));
vi.mock("@/services/cmo-cuso.service", async (original) => ({
  ...(await original<typeof import("@/services/cmo-cuso.service")>()),
  cmoRunnerUserId: vi.fn(async () => "runner"),
  startCmoTurn: readers.startCmoTurn,
}));

import { creditBucketRepository } from "@sokosumi/database/repositories";

import prisma from "@/lib/db/prisma";
import {
  COMPETITOR_CHECK_CREDITS,
  runProjectCompetitorCheck,
} from "@/services/competitor-check.service";
import { syncCompetitorChecks } from "@/services/competitor-check-sync.service";
import {
  addTrackedCompetitor,
  competitorChecksOnFor,
  setCompetitorChecks,
} from "@/services/competitors.service";
import {
  deleteSeededCusos,
  type SeededProject,
  seedCuso,
  seedProject,
} from "@/test-fixtures/cmo-competitors-db";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const CREDIT = 10_000_000_000n;
const DAY = 86_400_000;
const MONDAY = new Date("2026-11-16T09:00:00Z");

async function poolCredits(project: SeededProject): Promise<bigint> {
  const cents = await prisma.$transaction((tx) =>
    creditBucketRepository.getBalance(null, project.organizationId, tx),
  );
  return cents / CREDIT;
}

async function tracking(
  project: SeededProject,
  ...competitors: string[]
): Promise<void> {
  for (const name of competitors)
    await addTrackedCompetitor(project.projectId, {
      name,
      websiteUrl: `https://${name.toLowerCase()}.example/`,
    });
}

function checks(project: SeededProject) {
  return prisma.competitorCheck.findMany({
    where: { projectId: project.projectId },
    orderBy: { createdAt: "asc" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  readers.readCompetitorPage.mockImplementation(async (url: string) => ({
    url,
    html: "<html></html>",
    lines: Array.from({ length: 12 }, (_unused, index) => `Line ${index}`),
  }));
  readers.searchExa.mockResolvedValue({ results: [], costUsd: 0.007 });
});

afterEach(async () => {
  if (enabled) await deleteSeededCusos();
});

describe.skipIf(!enabled)("a Project's own weekly check (PostgreSQL)", () => {
  it("runs only once a member turned it on, and the organization pays once", async () => {
    const project = await seedProject(100n);
    await tracking(project, "Calendly", "Zcal");
    expect(await runProjectCompetitorCheck(project.projectId, MONDAY)).toBe(
      "paused",
    );
    expect(await checks(project)).toEqual([]);

    await setCompetitorChecks(project.projectId, true);
    expect(await runProjectCompetitorCheck(project.projectId, MONDAY)).toBe(
      "checked",
    );
    expect(
      await runProjectCompetitorCheck(
        project.projectId,
        new Date(MONDAY.getTime() + DAY),
      ),
    ).toBe("not_due");
    const price = BigInt(COMPETITOR_CHECK_CREDITS * 2);
    expect(await poolCredits(project)).toBe(100n - price);
    const [check] = await checks(project);
    expect(check).toMatchObject({
      competitorCount: 2,
      chargedCents: price * CREDIT,
    });
    const debit = await prisma.transaction.findUniqueOrThrow({
      where: { id: check?.transactionId ?? "" },
    });
    expect(debit).toMatchObject({
      amount: -price * CREDIT,
      organizationId: project.organizationId,
      userId: null,
    });

    expect(
      await runProjectCompetitorCheck(
        project.projectId,
        new Date(MONDAY.getTime() + 7 * DAY),
      ),
    ).toBe("checked");
    expect(await poolCredits(project)).toBe(100n - 2n * price);
  });

  it("redoes a check that died, without charging it again", async () => {
    const project = await seedProject(100n);
    await tracking(project, "Calendly");
    await setCompetitorChecks(project.projectId, true);
    await runProjectCompetitorCheck(project.projectId, MONDAY);
    const charged = await poolCredits(project);
    await prisma.competitorCheck.updateMany({
      where: { projectId: project.projectId },
      data: { finishedAt: null },
    });
    expect(
      await runProjectCompetitorCheck(
        project.projectId,
        new Date(MONDAY.getTime() + 2 * 3_600_000),
      ),
    ).toBe("checked");
    expect(await poolCredits(project)).toBe(charged);
    expect(await checks(project)).toHaveLength(1);
  });

  it("does not run, and charges nothing, when the credits do not cover it", async () => {
    const project = await seedProject(5n);
    await tracking(project, "Calendly", "Zcal");
    await setCompetitorChecks(project.projectId, true);
    expect(await runProjectCompetitorCheck(project.projectId, MONDAY)).toBe(
      "unfunded",
    );
    expect(await poolCredits(project)).toBe(5n);
    expect(await checks(project)).toEqual([]);
    expect(readers.readCompetitorPage).not.toHaveBeenCalled();
  });

  it("offers a bot the competitor tools only while a Project it works in has the check on", async () => {
    const project = await seedProject(0n);
    const other = await seedProject(0n);
    const personal = { projectId: null, workspaceId: project.workspaceId };
    const projectBot = {
      projectId: project.projectId,
      workspaceId: project.workspaceId,
    };
    expect(await competitorChecksOnFor(personal)).toBe(false);
    await setCompetitorChecks(other.projectId, true);
    // Another workspace's Project does not count.
    expect(await competitorChecksOnFor(personal)).toBe(false);
    await setCompetitorChecks(project.projectId, true);
    expect(await competitorChecksOnFor(personal)).toBe(true);
    expect(await competitorChecksOnFor(projectBot)).toBe(true);
    expect(
      await competitorChecksOnFor({
        projectId: other.projectId,
        workspaceId: project.workspaceId,
      }),
    ).toBe(false);
  });

  it("stops when it is turned off and keeps the day it was first turned on", async () => {
    const project = await seedProject(100n);
    await tracking(project, "Calendly");
    await setCompetitorChecks(project.projectId, true);
    const since = async () =>
      (
        await prisma.project.findUniqueOrThrow({
          where: { id: project.projectId },
          select: { competitorChecksSince: true },
        })
      ).competitorChecksSince;
    const first = await since();
    await setCompetitorChecks(project.projectId, true);
    expect(await since()).toEqual(first);
    await setCompetitorChecks(project.projectId, false);
    expect(await since()).toBeNull();
    expect(await runProjectCompetitorCheck(project.projectId, MONDAY)).toBe(
      "paused",
    );
  });
});

describe.skipIf(!enabled)("the weekly competitor sync (PostgreSQL)", () => {
  it("checks paid Cusos and the Projects that turned it on, each on its own payer", async () => {
    const cuso = await seedCuso(100n);
    const on = await seedProject(100n);
    const off = await seedProject(100n);
    for (const project of [cuso, on, off]) await tracking(project, "Calendly");
    await setCompetitorChecks(on.projectId, true);
    // A CMO Project is checked once, as its Cuso, whatever its own switch says.
    await prisma.project.update({
      where: { id: cuso.projectId },
      data: { competitorChecksSince: MONDAY },
    });

    const counts = await syncCompetitorChecks(() => true, MONDAY);

    expect(counts).toMatchObject({ checked: 2, failed: 0 });
    expect(await checks(off)).toEqual([]);
    const [own] = await checks(on);
    expect(own?.transactionId).toEqual(expect.any(String));
    const cusoChecks = await checks(cuso);
    expect(cusoChecks).toHaveLength(1);
    expect(cusoChecks[0]?.transactionId).toBeNull();
    expect(
      await prisma.sokoBotUsage.count({
        where: {
          sokoBotId: cuso.sokoBotId,
          idempotencyKey: `cmo-competitor-check:${cusoChecks[0]?.id}`,
        },
      }),
    ).toBe(1);
    // Only Cuso writes the week's feed after his check.
    expect(readers.startCmoTurn).toHaveBeenCalledTimes(1);
  });
});
