import { randomUUID } from "node:crypto";
import { HistoryKind, TaskStatus } from "@sokosumi/database";
import { seoTaskDescription } from "@sokosumi/utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import { findSeoAuditOnlyHitIds } from "./seo-audit-search-hits";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const userId = randomUUID();
const workspaceId = randomUUID();
const PACKET = { price: { markupPercent: 7345 } };

const ids: Record<string, string> = {};

describe.skipIf(!enabled)("findSeoAuditOnlyHitIds", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Search hits fixture",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    const rows = {
      hidden: seoTaskDescription("Audit of shop.example", "seo_audit", PACKET),
      visible: seoTaskDescription(
        "Audit of markupPercent shop",
        "seo_audit",
        PACKET,
      ),
      // A focused check's `seo_job` line is shown to people, so it stays searchable.
      focused: seoTaskDescription("Check of page", "seo_job", PACKET),
      // Prose that only starts like the marker, with no JSON object.
      prose: "seo_audit: fix markupPercent labels",
    };
    for (const [key, description] of Object.entries(rows)) {
      const task = await prisma.task.create({
        data: {
          workspaceId,
          ownerId: userId,
          status: TaskStatus.FAILED,
          name: key,
          description,
        },
      });
      ids[key] = task.id;
    }
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("lists only the Tasks whose hit sits inside the hidden seo_audit line", async () => {
    const found = await findSeoAuditOnlyHitIds("markupPercent");
    expect(found.filter((id) => Object.values(ids).includes(id))).toEqual([
      ids.hidden,
    ]);
  });

  it("reads a term without a hit as no Task", async () => {
    expect(await findSeoAuditOnlyHitIds("no-such-term-7345x")).toEqual([]);
  });

  it("lists the history row of that Task for the history search", async () => {
    const history = await prisma.history.findMany({
      where: { kind: HistoryKind.TASK, entityId: { in: Object.values(ids) } },
      select: { id: true, entityId: true },
    });
    const found = await findSeoAuditOnlyHitIds("markupPercent", {
      table: "history",
    });
    expect(
      history
        .filter((row) => found.includes(row.id))
        .map((row) => row.entityId),
    ).toEqual([ids.hidden]);
  });
});
