/** Soko Bot records name their Requester (ADR 0056), against a migrated, disposable PostgreSQL database.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-requester.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { MemberRole } from "@sokosumi/database";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";

import { sokoBotRuntimeService } from "./soko-bot-runtime.service";
import {
  createSokoBotSchedule,
  updateSokoBotSchedule,
} from "./soko-bot-schedule.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)("Soko Bot records name who asked", () => {
  let organizationId: string;
  let workspaceId: string;
  let botId: string;
  const people: Record<"owner" | "admin" | "member", string> = {
    owner: "",
    admin: "",
    member: "",
  };

  async function person(role: string) {
    const id = randomUUID();
    await prisma.user.create({
      data: {
        id,
        name: `${role} fixture`,
        email: `${id}@example.test`,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.member.create({
      data: { userId: id, organizationId, role },
    });
    return id;
  }

  async function turn(requestedByUserId: string | null) {
    return prisma.sokoBotTurn.create({
      data: {
        sokoBotId: botId,
        requestedByUserId,
        workspaceId,
        source: "SCHEDULE",
        clientTurnId: randomUUID(),
        userMessage: "Weekly review",
        capabilityNames: [],
        deadlineAt: new Date(Date.now() + 60_000),
      },
    });
  }

  async function decision(requestedByUserId: string | null) {
    const { id: turnId } = await turn(requestedByUserId);
    return prisma.sokoBotPendingDecision.create({
      data: {
        sokoBotId: botId,
        turnId,
        requestedByUserId,
        workspaceId,
        toolName: "hire_agent",
        proposal: {},
        reason: "Hire an Agent",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
  }

  beforeEach(async () => {
    organizationId = randomUUID();
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Requester fixture",
        slug: organizationId,
      },
    });
    people.owner = await person(MemberRole.OWNER);
    people.admin = await person(MemberRole.ADMIN);
    people.member = await person(MemberRole.MEMBER);
    const workspace = await prisma.workspace.create({
      data: { organizationId },
    });
    workspaceId = workspace.id;
    const bot = await prisma.sokoBot.create({
      data: { userId: people.member, workspaceId },
    });
    botId = bot.id;
  });

  afterEach(async () => {
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({
      where: { id: { in: Object.values(people) } },
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores a turn, a pending decision and a schedule with no Requester", async () => {
    const stored = await decision(null);
    const schedule = await prisma.sokoBotSchedule.create({
      data: {
        sokoBotId: botId,
        requestedByUserId: null,
        workspaceId,
        name: "Morning brief",
        timezone: "UTC",
        cronExpression: "0 8 * * *",
        prompt: "Brief me",
        systemKey: "morning-brief",
        nextRunAt: new Date(Date.now() + 60_000),
      },
    });

    const storedTurn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: stored.turnId },
    });
    expect(storedTurn.requestedByUserId).toBeNull();
    expect(stored.requestedByUserId).toBeNull();
    expect(schedule.requestedByUserId).toBeNull();
  });

  it("keeps the records of a Requester who deleted their account, with no Requester", async () => {
    const asked = await decision(people.admin);

    await prisma.user.delete({ where: { id: people.admin } });

    const kept = await prisma.sokoBotPendingDecision.findUniqueOrThrow({
      where: { id: asked.id },
      include: { turn: true },
    });
    expect(kept.requestedByUserId).toBeNull();
    expect(kept.turn.requestedByUserId).toBeNull();
  });

  describe("answering a pending decision with no Requester", () => {
    it("refuses a plain member", async () => {
      const unasked = await decision(null);

      await expect(
        sokoBotRuntimeService.resolveDecision(people.member, unasked.id, false),
      ).rejects.toThrow("Pending decision not found");
      const unchanged = await prisma.sokoBotPendingDecision.findUniqueOrThrow({
        where: { id: unasked.id },
      });
      expect(unchanged.status).toBe("PENDING");
    });

    it.each([
      ["owner", "owner"],
      ["admin", "admin"],
    ] as const)("accepts an Organization %s", async (_label, role) => {
      const unasked = await decision(null);

      const answered = await sokoBotRuntimeService.resolveDecision(
        people[role],
        unasked.id,
        false,
      );

      expect(answered.status).toBe("REJECTED");
      expect(answered.resolvedByUserId).toBe(people[role]);
    });
  });

  it("lets the Requester answer their own pending decision", async () => {
    const asked = await decision(people.member);

    const answered = await sokoBotRuntimeService.resolveDecision(
      people.member,
      asked.id,
      false,
    );

    expect(answered.status).toBe("REJECTED");
  });

  it.each([
    ["owner", "owner"],
    ["admin", "admin"],
  ] as const)(
    "lets an Organization %s answer a pending decision another member asked for",
    async (_label, role) => {
      const asked = await decision(people.member);

      const answered = await sokoBotRuntimeService.resolveDecision(
        people[role],
        asked.id,
        false,
      );

      expect(answered.status).toBe("REJECTED");
      expect(answered.resolvedByUserId).toBe(people[role]);
    },
  );

  it("refuses a different member for a pending decision with a Requester", async () => {
    const asked = await decision(people.admin);

    await expect(
      sokoBotRuntimeService.resolveDecision(people.member, asked.id, false),
    ).rejects.toThrow("Pending decision not found");
  });

  it("leaves a schedule's Requester unchanged when its prompt, cron or timezone change", async () => {
    const created = await createSokoBotSchedule({
      userId: people.member,
      workspaceId,
      name: "Weekly review",
      timezone: "UTC",
      cronExpression: "0 9 * * 1",
      prompt: "Review the week",
    });

    const edited = await updateSokoBotSchedule({
      userId: people.member,
      scheduleId: created.id,
      prompt: "Review the week and plan the next",
      cronExpression: "30 9 * * 1",
      timezone: "Europe/Berlin",
    });

    expect(edited.prompt).toBe("Review the week and plan the next");
    expect(edited.timezone).toBe("Europe/Berlin");
    expect(edited.requestedByUserId).toBe(people.member);
  });
});
