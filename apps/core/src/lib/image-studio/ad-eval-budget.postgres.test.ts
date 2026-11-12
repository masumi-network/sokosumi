import { randomUUID } from "node:crypto";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import prisma from "@/lib/db/prisma";

import { finalizeAdEval, reserveAdEval } from "./ad-eval-budget";
import { AD_EVAL_RESERVATION_USD_MICROS } from "./ad-eval-judge";

vi.mock("./ad-eval-judge", () => ({
  AD_EVAL_RESERVATION_USD_MICROS: 250_000n,
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const NOW = new Date("2097-02-10T23:59:59.999Z");
const NEXT_DAY = new Date("2097-02-11T00:00:00.000Z");
const RUBRIC_VERSION = "budget-race-v1";

interface Fixture {
  organizationId: string;
  workspaceId: string;
  projectId: string;
  assetIds: string[];
}

let userId: string;
let fixtures: Fixture[] = [];
const additionalFixtures: Fixture[] = [];

async function makeFixture(existing?: Fixture): Promise<Fixture> {
  const organization = existing
    ? { id: existing.organizationId }
    : await prisma.organization.create({
        data: {
          name: "Ad eval budget fixture",
          slug: `ad-eval-${randomUUID()}`,
        },
        select: { id: true },
      });
  const workspace = existing
    ? { id: existing.workspaceId }
    : await prisma.workspace.create({
        data: { organizationId: organization.id },
        select: { id: true },
      });
  const project = await prisma.project.create({
    data: { workspaceId: workspace.id, name: "Ad eval budget fixture" },
    select: { id: true },
  });
  const assetIds: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    const job = await prisma.projectImageJob.create({
      data: {
        projectId: project.id,
        workspaceId: workspace.id,
        requestedByUserId: userId,
        kind: "GENERATE",
        model: "fal-ai/flux-2-pro",
        prompt: "Product ad",
        settings: {},
        referenceAssetIds: [],
        idempotencyKey: randomUUID(),
        status: "SUCCEEDED",
      },
      select: { id: true },
    });
    const asset = await prisma.projectImageAsset.create({
      data: {
        projectId: project.id,
        workspaceId: workspace.id,
        jobId: job.id,
        rootId: randomUUID(),
        version: 1,
        model: "fal-ai/flux-2-pro",
        prompt: "Product ad",
        settings: {},
        blobPathname: `ad-eval-budget/${job.id}.png`,
        contentType: "image/png",
        width: 1080,
        height: 1080,
        bytes: 1,
        checksum: "fixture",
      },
      select: { id: true },
    });
    assetIds.push(asset.id);
  }
  return {
    organizationId: organization.id,
    workspaceId: workspace.id,
    projectId: project.id,
    assetIds,
  };
}

function reserve(fixture: Fixture, assetId: string, overrides = {}) {
  return reserveAdEval({
    assetId,
    workspaceId: fixture.workspaceId,
    rubricVersion: RUBRIC_VERSION,
    workspaceDailyLimit: 100,
    globalDailyUsd: 100,
    now: NOW,
    ...overrides,
  });
}

function finalize(id: string, costUsdMicros: bigint | null = 10_000n) {
  return finalizeAdEval({
    id,
    checks: [],
    judge: { overall: 4 },
    judgeModel: "judge",
    overall: 4,
    costUsdMicros,
    latencyMs: 100,
  });
}

describe.skipIf(!enabled)("ad evaluation reservations on PostgreSQL", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: "Ad eval budget fixture",
        email: `ad-eval-budget-${randomUUID()}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    userId = user.id;
    fixtures = [await makeFixture(), await makeFixture()];
  });

  beforeEach(async () => {
    await prisma.adEval.deleteMany({
      where: {
        workspaceId: {
          in: [...fixtures, ...additionalFixtures].map(
            (row) => row.workspaceId,
          ),
        },
      },
    });
    await prisma.adEvalDailyBudget.deleteMany({
      where: { day: { in: [new Date("2097-02-10T00:00:00Z"), NEXT_DAY] } },
    });
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({
      where: {
        id: {
          in: [...fixtures, ...additionalFixtures].map(
            (row) => row.workspaceId,
          ),
        },
      },
    });
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [...fixtures, ...additionalFixtures].map(
            (row) => row.organizationId,
          ),
        },
      },
    });
    await prisma.adEvalDailyBudget.deleteMany({
      where: { day: { in: [new Date("2097-02-10T00:00:00Z"), NEXT_DAY] } },
    });
    if (userId) await prisma.user.delete({ where: { id: userId } });
  });

  it("admits only the workspace's remaining slots on competing connections", async () => {
    const fixture = fixtures[0];
    const rows = await Promise.all(
      fixture.assetIds.map((assetId) =>
        reserve(fixture, assetId, { workspaceDailyLimit: 2 }),
      ),
    );

    expect(rows.filter(Boolean)).toHaveLength(2);
    expect(
      await prisma.adEval.count({
        where: { workspaceId: fixture.workspaceId },
      }),
    ).toBe(2);
  });

  it("shares the global spend cap across competing workspaces", async () => {
    const rows = await Promise.all(
      fixtures.flatMap((fixture) =>
        fixture.assetIds.map((assetId) =>
          reserve(fixture, assetId, { globalDailyUsd: 0.5 }),
        ),
      ),
    );

    expect(rows.filter(Boolean)).toHaveLength(2);
    const spend = await prisma.adEval.aggregate({
      where: { createdAt: NOW },
      _sum: { costUsdMicros: true },
    });
    expect(spend._sum.costUsdMicros).toBe(2n * AD_EVAL_RESERVATION_USD_MICROS);
  });

  it.each([0, 1])(
    "refuses the second workspace when workspace %i wins first",
    async (first) => {
      expect(
        await reserve(fixtures[first], fixtures[first].assetIds[0], {
          globalDailyUsd: 0.25,
        }),
      ).not.toBeNull();
      const second = fixtures[1 - first];
      expect(
        await reserve(second, second.assetIds[0], { globalDailyUsd: 0.25 }),
      ).toBeNull();
    },
  );

  it("inserts once when the same asset and rubric race", async () => {
    const fixture = fixtures[0];
    const rows = await Promise.all(
      Array.from({ length: 4 }, () => reserve(fixture, fixture.assetIds[0])),
    );
    expect(rows.filter(Boolean)).toHaveLength(1);
    expect(
      await reserve(fixture, fixture.assetIds[0], {
        rubricVersion: "budget-v2",
      }),
    ).not.toBeNull();
  });

  it("keeps late finalization charged to its UTC admission day", async () => {
    const fixture = fixtures[0];
    const id = await reserve(fixture, fixture.assetIds[0], {
      workspaceDailyLimit: 1,
    });
    expect(id).not.toBeNull();
    if (!id) throw new Error("Reservation missing");
    await finalize(id);

    expect(
      await reserve(fixture, fixture.assetIds[1], { workspaceDailyLimit: 1 }),
    ).toBeNull();
    expect(
      await reserve(fixture, fixture.assetIds[1], {
        workspaceDailyLimit: 1,
        now: NEXT_DAY,
      }),
    ).not.toBeNull();
    const row = await prisma.adEval.findUniqueOrThrow({ where: { id } });
    expect(row.createdAt).toEqual(NOW);
    const ledger = await prisma.adEvalDailyBudget.findUniqueOrThrow({
      where: {
        day_scope: { day: new Date("2097-02-10T00:00:00Z"), scope: "global" },
      },
    });
    expect(ledger.costUsdMicros).toBe(10_000n);
  });

  it("reconciles known costs exactly once under competing finalizations", async () => {
    const fixture = fixtures[0];
    const id = await reserve(fixture, fixture.assetIds[0], {
      globalDailyUsd: 0.3,
    });
    if (!id) throw new Error("Reservation missing");
    expect(
      await reserve(fixture, fixture.assetIds[1], { globalDailyUsd: 0.3 }),
    ).toBeNull();
    await Promise.all([finalize(id), finalize(id)]);
    const ledger = await prisma.adEvalDailyBudget.findUniqueOrThrow({
      where: {
        day_scope: { day: new Date("2097-02-10T00:00:00Z"), scope: "global" },
      },
    });
    expect(ledger.costUsdMicros).toBe(10_000n);
    expect(
      await reserve(fixture, fixture.assetIds[1], { globalDailyUsd: 0.3 }),
    ).not.toBeNull();
  });

  it("preserves the workspace count after project and asset deletion", async () => {
    const deleted = await makeFixture();
    additionalFixtures.push(deleted);
    expect(
      await reserve(deleted, deleted.assetIds[0], { workspaceDailyLimit: 1 }),
    ).not.toBeNull();
    await prisma.project.delete({ where: { id: deleted.projectId } });
    const replacement = await makeFixture(deleted);
    additionalFixtures.push(replacement);
    expect(
      await reserve(replacement, replacement.assetIds[0], {
        workspaceDailyLimit: 1,
      }),
    ).toBeNull();
  });

  it("preserves global reservations after workspace deletion", async () => {
    const deleted = await makeFixture();
    additionalFixtures.push(deleted);
    const id = await reserve(deleted, deleted.assetIds[0], {
      globalDailyUsd: 0.25,
    });
    if (!id) throw new Error("Reservation missing");
    await prisma.workspace.delete({ where: { id: deleted.workspaceId } });
    await finalize(id);
    expect(
      await reserve(fixtures[0], fixtures[0].assetIds[0], {
        globalDailyUsd: 0.25,
      }),
    ).toBeNull();
  });
});
