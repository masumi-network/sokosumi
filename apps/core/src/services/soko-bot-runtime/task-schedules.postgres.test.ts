import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import type { AuthorizedSokoBotRuntime } from "../soko-bot-runtime.service";
import type { RuntimeOperations } from "./operations";
import { removeTaskSchedule, saveTaskSchedule } from "./task-schedules";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const runtime = {
  commitReceipt: async (
    _authorized: unknown,
    _toolCallId: string,
    _targetId: string,
    result: unknown,
  ) => result,
} as unknown as RuntimeOperations;

describe.skipIf(!enabled)("a Soko Bot's Task Schedules", () => {
  let userId: string;
  let workspaceId: string;
  let botId: string;

  const authorized = () =>
    ({
      turn: {
        id: randomUUID(),
        sokoBotId: botId,
        workspaceId,
        actingUserId: userId,
        versionId: "v38",
        source: "CHAT",
        chainDepth: 0,
      },
      askedByKind: "OWNER",
      reader: { sharedScope: null },
    }) as unknown as AuthorizedSokoBotRuntime;

  const call = (capability: string, input: Record<string, unknown>) =>
    ({
      capability,
      sessionId: "session",
      turnId: "turn",
      toolCallId: randomUUID(),
      input,
    }) as never;

  beforeEach(async () => {
    userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        name: "Schedule owner",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    workspaceId = (await prisma.workspace.create({ data: { userId } })).id;
    botId = (await prisma.sokoBot.create({ data: { userId, workspaceId } })).id;
  });

  afterEach(async () => {
    await prisma.taskSchedule.deleteMany({ where: { workspaceId } });
    await prisma.sokoBot.deleteMany({ where: { id: botId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("creates, pauses and deletes one as the owner, with the bot as Creator", async () => {
    const created = (await saveTaskSchedule(
      runtime,
      call("save_task_schedule", {
        name: "Daily competitor research",
        brief: "Post today's competitor moves.",
        assigneeSokoBotId: botId,
        cron: "0 9 * * 1-5",
        timezone: "Europe/Berlin",
      }),
      authorized(),
    )) as { taskSchedule: { id: string } };
    const row = await prisma.taskSchedule.findUniqueOrThrow({
      where: { id: created.taskSchedule.id },
    });
    expect(row).toEqual(
      expect.objectContaining({
        ownerId: userId,
        creatorSokoBotId: botId,
        creatorUserId: null,
        expr: "0 9 * * 1-5",
        timezone: "Europe/Berlin",
        assigneeSokoBotId: botId,
        state: "ACTIVE",
      }),
    );

    await saveTaskSchedule(
      runtime,
      call("save_task_schedule", {
        scheduleId: row.id,
        state: "PAUSED",
        endsOn: "2026-12-31",
      }),
      authorized(),
    );
    expect(
      await prisma.taskSchedule.findUniqueOrThrow({ where: { id: row.id } }),
    ).toEqual(expect.objectContaining({ state: "PAUSED", endsMode: "ON" }));

    await removeTaskSchedule(
      runtime,
      call("delete_task_schedule", { scheduleId: row.id }),
      authorized(),
    );
    expect(
      await prisma.taskSchedule.findUnique({ where: { id: row.id } }),
    ).toBeNull();
  });
});
