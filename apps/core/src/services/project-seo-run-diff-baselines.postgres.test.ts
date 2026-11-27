import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parsePublicSeoArtifact } from "@/helpers/project-seo-report";
import prisma from "@/lib/db/prisma";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { focusedReport, SEO_TEST_PAGE } from "@/test-fixtures/project-seo";
import {
  addProjectSeoPage,
  getProjectSeoWorkspace,
} from "./project-seo.service";

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
/** One more check than the workspace shows. */
const CHECKS = 101;
const HOUR_MS = 3_600_000;

describe.skipIf(!enabled)(
  "SEO run diff past a full evidence list with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.create({
        data: {
          id: userId,
          name: "Run diff fixture",
          email: `${userId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          workspace: { create: { id: workspaceId } },
        },
      });
      await prisma.project.create({
        data: { id: projectId, workspaceId, name: "Run diff fixture" },
      });
    });
    afterAll(async () => {
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });

    it("compares the oldest check it shows with the check just past the list, and shows that check nowhere", async () => {
      const page = await addProjectSeoPage(actor, {
        url: SEO_TEST_PAGE,
        relationship: "primary",
      });
      const start = Date.UTC(2026, 10, 1, 12);
      const times = Array.from({ length: CHECKS }, (_, index) =>
        new Date(start - index * HOUR_MS).toISOString(),
      );
      const rows = times.map((observedAt) => ({
        id: randomUUID(),
        projectId,
        source: "seo_coworker",
        kind: "page_check",
        sourceKey: randomUUID(),
        pageIds: [page.id],
        artifactHash: "run-diff-baseline",
        payload: parsePublicSeoArtifact({ ...focusedReport(), observedAt }),
        observedAt: new Date(observedAt),
      }));
      await prisma.projectSeoObservation.createMany({ data: rows });
      const workspace = await getProjectSeoWorkspace(actor);
      const shown = rows.at(-2)!,
        past = rows.at(-1)!;
      expect(
        workspace.runs?.find((run) => run.observationId === shown.id)?.runDiff,
      ).toMatchObject({ from: times.at(-1), comparable: true });
      expect(workspace.runs?.some((run) => run.observationId === past.id)).toBe(
        false,
      );
    });
  },
);
