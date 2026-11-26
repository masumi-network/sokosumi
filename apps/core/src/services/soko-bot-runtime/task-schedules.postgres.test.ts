import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import { withFixtureSchemas } from "@/test/split-layout";
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
    // Deleting schedules and the workspace fires triggers that name a table
    // without its schema (ticket 19); the fixture scope resolves them on the
    // split layout. The code under test runs without it, and there creating a
    // schedule fires the same kind of trigger (projectTaskScheduleRuns), so the
    // file stays in split-layout-pending.txt until ticket 19 lands, like every
    // other test that creates Task Schedules through the service.
    await withFixtureSchemas(async (tx) => {
      await tx.taskSchedule.deleteMany({ where: { workspaceId } });
      await tx.sokoBot.deleteMany({ where: { id: botId } });
      await tx.workspace.deleteMany({ where: { id: workspaceId } });
      await tx.user.deleteMany({ where: { id: userId } });
    });
  });

  it("replays the first schedule when the same call is retried after its receipt was lost", async () => {
    const turn = authorized();
    const create = call("save_task_schedule", {
      name: "Daily competitor research",
      assigneeSokoBotId: botId,
      cron: "0 9 * * 1-5",
      timezone: "Europe/Berlin",
      state: "PAUSED",
    });
    // The first attempt commits, then its receipt is lost; the runtime
    // retries the same tool call.
    const first = (await saveTaskSchedule(runtime, create, turn)) as {
      taskSchedule: { id: string; state: string };
    };
    const retry = (await saveTaskSchedule(runtime, create, turn)) as {
      taskSchedule: { id: string; state: string };
    };
    expect(retry.taskSchedule.id).toBe(first.taskSchedule.id);
    expect(retry.taskSchedule.state).toBe("PAUSED");
    expect(await prisma.taskSchedule.count({ where: { workspaceId } })).toBe(1);
  });

  it("keeps the owner's resume when the paused create is retried later", async () => {
    const turn = authorized();
    const create = call("save_task_schedule", {
      name: "Daily competitor research",
      assigneeSokoBotId: botId,
      cron: "0 9 * * 1-5",
      timezone: "Europe/Berlin",
      state: "PAUSED",
    });
    const first = (await saveTaskSchedule(runtime, create, turn)) as {
      taskSchedule: { id: string };
    };
    await saveTaskSchedule(
      runtime,
      call("save_task_schedule", {
        scheduleId: first.taskSchedule.id,
        state: "ACTIVE",
      }),
      turn,
    );
    const retry = (await saveTaskSchedule(runtime, create, turn)) as {
      taskSchedule: { id: string; state: string };
    };
    expect(retry.taskSchedule).toEqual(
      expect.objectContaining({ id: first.taskSchedule.id, state: "ACTIVE" }),
    );
    expect(
      await prisma.taskSchedule.findUniqueOrThrow({
        where: { id: first.taskSchedule.id },
        select: { state: true },
      }),
    ).toEqual({ state: "ACTIVE" });
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
