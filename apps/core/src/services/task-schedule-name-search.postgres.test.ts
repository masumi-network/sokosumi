import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import { taskScheduleNameFilter } from "./task-schedule-read.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const userId = randomUUID();
const workspaceId = randomUUID();
const NAMES = [
  "Sale 50% off",
  "Sale 500 club",
  "Report a_b",
  "Report axb",
  "Backup c:\\d",
  "Backup c:d",
];

describe.skipIf(!enabled)("Task Schedule name search", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Schedule search",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    for (const name of NAMES) {
      await prisma.taskSchedule.create({
        data: {
          ownerId: userId,
          creatorUserId: userId,
          workspaceId,
          name,
          expr: "0 9 * * *",
          timezone: "UTC",
          anchorAt: new Date("2026-09-01T09:00:00Z"),
          ruleEffectiveFrom: new Date("2026-09-01T09:00:00Z"),
          epochId: randomUUID(),
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.taskSchedule.deleteMany({ where: { workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.$disconnect();
  });

  it.each([
    ["50%", "Sale 50% off"],
    ["A_B", "Report a_b"],
    ["c:\\d", "Backup c:\\d"],
  ])("finds %s as typed, ignoring case", async (q, name) => {
    const rows = await prisma.taskSchedule.findMany({
      where: { workspaceId, name: taskScheduleNameFilter(q) },
      select: { name: true },
    });

    expect(rows.map((row) => row.name)).toEqual([name]);
  });
});
