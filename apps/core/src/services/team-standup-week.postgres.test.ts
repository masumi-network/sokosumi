import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { updateTeamStandup } from "./team-standup-settings.service";
import {
  runWeekInReview,
  syncWeekInReviews,
} from "./team-standup-week.service";

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtimeById: vi.fn(async () => undefined),
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const DAY_MS = 24 * 60 * 60_000;

async function organizationWith(name: string) {
  const suffix = randomUUID().slice(0, 8);
  const user = (who: string, hideWeekFromStandup = false) =>
    prisma.user.create({
      data: {
        name: who,
        email: `${who.toLowerCase().replace(/\s/g, ".")}.${suffix}@week.test`,
        emailVerified: true,
        hideWeekFromStandup,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      select: { id: true, name: true },
    });
  const robin = await user("Robin Keller");
  const hannah = await user("Hannah Weber");
  const sam = await user("Sam Opted Out", true);
  const organization = await prisma.organization.create({
    data: {
      name,
      slug: `week-${suffix}`,
      members: {
        create: [
          { userId: robin.id, role: "owner" },
          { userId: hannah.id, role: "member" },
          { userId: sam.id, role: "member" },
        ],
      },
      workspace: { create: {} },
    },
    select: { id: true, workspace: { select: { id: true } } },
  });
  const vendor = await prisma.vendor.create({
    data: { name: "Week test", slug: `week-${suffix}` },
  });
  const mira = await prisma.coworker.create({
    data: {
      name: "Mira",
      slug: `mira-${suffix}`,
      capabilities: ["tasks", "chat"],
      vendorId: vendor.id,
    },
  });
  const standup = await prisma.teamStandup.create({
    data: { organizationId: organization.id, enabled: true },
  });
  return {
    robin,
    hannah,
    sam,
    organization,
    workspaceId: organization.workspace!.id,
    mira,
    standup,
  };
}

type World = Awaited<ReturnType<typeof organizationWith>>;

function finishedTask(
  world: World,
  input: {
    name: string;
    by: string;
    visibility?: "PRIVATE";
    at?: Date;
    assigneeId?: string;
  },
) {
  return prisma.task.create({
    data: {
      name: input.name,
      status: "COMPLETED",
      ...(input.visibility && { visibility: input.visibility }),
      workspaceId: world.workspaceId,
      organizationId: world.organization.id,
      ownerId: input.by,
      creatorUserId: input.by,
      ...(input.assigneeId && { assigneeId: input.assigneeId }),
      events: {
        create: {
          status: "COMPLETED",
          userId: input.assigneeId ? null : input.by,
          coworkerId: input.assigneeId ?? null,
          createdAt: input.at ?? new Date(),
        },
      },
    },
    select: { id: true },
  });
}

describe.skipIf(!enabled)("week in review", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("posts nothing in a week with nothing new", async () => {
    const world = await organizationWith("Quiet Week Co");
    const outcome = await runWeekInReview({
      standupId: world.standup.id,
      scheduledFor: new Date(),
      summarize: async () => {
        throw new Error("the model is not asked in a quiet week");
      },
    });
    expect(outcome?.status).toBe("QUIET");
    expect(
      await prisma.chatRoomMessage.count({
        where: { room: { organizationId: world.organization.id } },
      }),
    ).toBe(0);
  });

  it("counts what people did in public places, leaves out private work and people who opted out, and posts once", async () => {
    const world = await organizationWith("Busy Week Co");
    const roadmap = await finishedTask(world, {
      name: "Q1 roadmap draft",
      by: world.robin.id,
    });
    await finishedTask(world, {
      name: "Salary review (private)",
      by: world.robin.id,
      visibility: "PRIVATE",
    });
    await finishedTask(world, {
      name: "Old launch checklist",
      by: world.robin.id,
      at: new Date(Date.now() - 10 * DAY_MS),
    });
    await finishedTask(world, { name: "Sam's invoice run", by: world.sam.id });
    await finishedTask(world, {
      name: "EU pricing research",
      by: world.robin.id,
      assigneeId: world.mira.id,
    });
    await prisma.taskEvent.create({
      data: {
        taskId: roadmap.id,
        userId: world.hannah.id,
        comment: "Looks good, one question on the Q2 hiring line.",
      },
    });
    await prisma.dataTable.create({
      data: {
        workspaceId: world.workspaceId,
        title: "Launch leads",
        createdBy: world.hannah.id,
      },
    });
    await prisma.driveShare.create({
      data: {
        token: randomUUID(),
        workspaceId: world.workspaceId,
        sourceScope: "ORGANIZATION",
        ownerId: world.organization.id,
        kind: "FOLDER",
        folderPath: "/press",
        createdByUserId: world.hannah.id,
      },
    });
    await prisma.driveShare.create({
      data: {
        token: randomUUID(),
        workspaceId: world.workspaceId,
        sourceScope: "USER",
        ownerId: world.hannah.id,
        kind: "FOLDER",
        folderPath: "/personal",
        createdByUserId: world.hannah.id,
      },
    });

    let asked: unknown = null;
    const slot = new Date();
    const run = () =>
      runWeekInReview({
        standupId: world.standup.id,
        scheduledFor: slot,
        summarize: async (input) => {
          asked = input;
          return { summary: "Robin shipped the roadmap.", costUsd: 0.001 };
        },
      });
    const outcome = await run();
    expect(outcome?.status).toBe("POSTED");
    const root = await prisma.chatRoomMessage.findUniqueOrThrow({
      where: { id: outcome!.messageId! },
      select: {
        content: true,
        senderUserId: true,
        room: { select: { name: true } },
        userMentionsAsSource: { select: { userId: true } },
      },
    });
    expect(root.room.name).toBe("Stand-up");
    expect(root.senderUserId).toBeNull();
    expect(root.userMentionsAsSource).toEqual([]);
    expect(root.content).toContain(
      '- **Robin Keller** · 1 Task finished ("Q1 roadmap draft") · 1 Task handed out',
    );
    expect(root.content).toContain(
      "- **Hannah Weber** · 1 Task answered · 1 file shared · 1 table made",
    );
    expect(root.content).toContain('- **Mira** · "EU pricing research"');
    expect(root.content).toContain("Robin shipped the roadmap.");
    expect(root.content).toContain('"Include my week in the stand-up"');
    for (const hidden of ["Salary", "Old launch", "Sam", "hiring"])
      expect(root.content).not.toContain(hidden);
    expect(JSON.stringify(asked)).not.toContain("Sam");

    expect(await run()).toBeNull();
  });

  it("schedules the week from the stand-up's settings and gives an older stand-up its first slot without running", async () => {
    const world = await organizationWith("Schedule Co");
    const settings = await updateTeamStandup(world.organization.id, {
      timeOfDay: "09:00",
      timezone: "Europe/Zurich",
      weekInReviewWeekday: 5,
    });
    const next = new Date(settings.weekInReviewNextRunAt!);
    expect(
      new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Zurich",
      }).format(next),
    ).toBe("Fri 09:00");

    await prisma.teamStandup.update({
      where: { id: world.standup.id },
      data: { weekInReviewNextRunAt: null },
    });
    await syncWeekInReviews({ shouldContinue: () => true });
    const after = await prisma.teamStandup.findUniqueOrThrow({
      where: { id: world.standup.id },
      select: { weekInReviewNextRunAt: true },
    });
    expect(after.weekInReviewNextRunAt?.getTime()).toBe(next.getTime());
    expect(
      await prisma.teamStandupRun.count({
        where: { standupId: world.standup.id },
      }),
    ).toBe(0);

    const off = await updateTeamStandup(world.organization.id, {
      enabled: false,
    });
    expect(off.weekInReviewNextRunAt).toBeNull();
  });
});
