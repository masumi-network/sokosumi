import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { calculateAverageExecutionTime } from "@/helpers/agent";
import { createNetworkScope } from "@/lib/db/network-scope";
import { withFixtureSchemas } from "@/test/split-layout";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

// Agent, Job and JobEvent are Network tables; Organization and Workspace are shared.
const scope = () => createNetworkScope("mainnet");
const agentId = randomUUID();
const pricingId = randomUUID();
const workspaceId = randomUUID();
const organizationId = randomUUID();
const ZONE_BEFORE = process.env.TZ;

// 2026-11-27 minus 90 days is 2026-08-29, 12:00 UTC. Berlin left summer time
// on 2026-10-25, so a local-zone `setDate` there lands at 11:00 UTC.
const clock = new Date("2026-11-27T12:00:00.000Z");

async function jobAt(createdAt: string, seconds: number) {
  const start = new Date(createdAt);
  const db = scope().networkDb;
  const job = await db.job.create({
    data: {
      agentId,
      workspaceId,
      agentJobId: randomUUID(),
      jobType: "FREE",
      createdAt: start,
    },
  });
  await db.jobEvent.create({
    data: {
      jobId: job.id,
      status: "COMPLETED",
      createdAt: new Date(start.getTime() + seconds * 1000),
    },
  });
}

describe.skipIf(!enabled)("Agent average run time against PostgreSQL", () => {
  beforeAll(async () => {
    await withFixtureSchemas(async (tx) => {
      await tx.organization.create({
        data: {
          id: organizationId,
          name: "Average run time",
          slug: `average-time-${organizationId}`,
        },
      });
      await tx.workspace.create({ data: { id: workspaceId, organizationId } });
    });
    await scope().networkDb.agent.create({
      data: {
        id: agentId,
        blockchainIdentifier: `average-time-${agentId}`,
        name: "Average run time Agent",
        lastUptimeCheck: clock,
        uptimeCount: 1,
        uptimeCheckCount: 1,
        isShown: true,
        pricing: { create: { id: pricingId, pricingType: "FREE" } },
      },
    });
    // Half an hour before the UTC cutoff: out. Half an hour after: in.
    await jobAt("2026-08-29T11:30:00.000Z", 1000);
    await jobAt("2026-08-29T12:30:00.000Z", 100);
  });

  afterAll(async () => {
    const db = scope().networkDb;
    await db.job.deleteMany({ where: { agentId } });
    await db.agent.delete({ where: { id: agentId } });
    await db.agentPricing.delete({ where: { id: pricingId } });
    await withFixtureSchemas(async (tx) => {
      await tx.workspace.delete({ where: { id: workspaceId } });
      await tx.organization.delete({ where: { id: organizationId } });
    });
  });

  it("cuts off 90 days back in UTC in a zone with summer time", async () => {
    process.env.TZ = "Europe/Berlin";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock);
    try {
      await expect(
        calculateAverageExecutionTime(agentId, scope()),
      ).resolves.toBe(100);
    } finally {
      vi.useRealTimers();
      if (ZONE_BEFORE === undefined) delete process.env.TZ;
      else process.env.TZ = ZONE_BEFORE;
    }
  });
});
