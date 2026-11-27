/**
 * The Cuso path test's do-nothing run against a real PostgreSQL: a Cuso
 * nobody briefs must fail every stage, or the checks prove nothing. It
 * starts no turn and calls no model.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/evals/cmo-path/stages.postgres.test.ts
 */
import { afterAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import { CMO_PATH_DEV_BRANDS } from "./brands";
import { runCmoPathBrand } from "./stages";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)("the Cuso path test on Postgres", () => {
  const lanes: number[] = [];
  afterAll(async () => {
    await prisma.evalLane.deleteMany({ where: { lane: { in: lanes } } });
  });

  it.each(CMO_PATH_DEV_BRANDS.map((brand) => [brand.id, brand] as const))(
    "fails every stage of %s when Cuso does nothing",
    async (_id, brand) => {
      const result = await runCmoPathBrand(brand, "noop");
      lanes.push(result.lane);
      expect(result.stages.map((stage) => stage.stage)).toEqual([
        "brand-brain",
        "strategy",
        "month",
        "mid-month",
        "report",
      ]);
      for (const stage of result.stages) {
        expect(stage.checks.length, stage.stage).toBeGreaterThan(0);
        expect(
          stage.pass,
          `${stage.stage}: ${JSON.stringify(stage.checks)}`,
        ).toBe(false);
        // Failing because the stage could not run would prove nothing.
        expect(stage.checks.map((c) => c.label)).not.toContain("Stage ran");
      }
      const lane = await prisma.evalLane.findUniqueOrThrow({
        where: { lane: result.lane },
        select: { workspaceId: true, cusoProjectId: true },
      });
      // The lane is the eval world before any work: a stand-in per network.
      expect(
        await prisma.projectSocialConnection.count({
          where: {
            projectId: lane.cusoProjectId ?? "",
            composioConnectedAccountId: { startsWith: "eval:" },
          },
        }),
      ).toBe(brand.networks.length);
    },
    120_000,
  );
});
