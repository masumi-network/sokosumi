import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import { requestProjectClose } from "./project-close-lifecycle.service";
import {
  createSharedSokoBot,
  reactivateSharedSokoBot,
} from "./soko-bot-shared-create.service";

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");

const BLOCKED_PROOF_MS = 300;

interface Fixture {
  org: string;
  workspace: string;
  owner: string;
  member: string;
  outsider: string;
  joiner: string;
}

function newFixture(): Fixture {
  return {
    org: `org-${randomUUID()}`,
    workspace: randomUUID(),
    owner: `owner-${randomUUID()}`,
    member: `member-${randomUUID()}`,
    outsider: `outsider-${randomUUID()}`,
    joiner: `joiner-${randomUUID()}`,
  };
}

function addMember(
  client: Pick<typeof prisma, "$executeRaw">,
  fixture: Fixture,
  userId: string,
  role: string,
) {
  return client.$executeRaw`INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES (${randomUUID()}, ${userId}, ${fixture.org}, ${role}, now())`;
}

async function seed(fixture: Fixture) {
  for (const id of [
    fixture.owner,
    fixture.member,
    fixture.outsider,
    fixture.joiner,
  ]) {
    await prisma.$executeRaw`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${id}, ${id}, ${`${id}@fixture.invalid`}, true, now(), now())`;
  }
  await prisma.$executeRaw`INSERT INTO organization (id, name, slug) VALUES (${fixture.org}, 'Org', ${fixture.org})`;
  await prisma.$executeRaw`INSERT INTO workspace (id, "organizationId", "updatedAt") VALUES (${fixture.workspace}::uuid, ${fixture.org}, now())`;
  await addMember(prisma, fixture, fixture.owner, "owner");
  await addMember(prisma, fixture, fixture.member, "member");
}

// Each step on its own, so one failing delete cannot leave the rest behind.
async function cleanUp(fixture: Fixture) {
  const steps = [
    () =>
      prisma.projectEvent.deleteMany({
        where: { project: { workspaceId: fixture.workspace } },
      }),
    () =>
      prisma.projectCloseOperation.deleteMany({
        where: { project: { workspaceId: fixture.workspace } },
      }),
    () =>
      prisma.sokoBot.deleteMany({ where: { workspaceId: fixture.workspace } }),
    () =>
      prisma.chatRoom.deleteMany({ where: { organizationId: fixture.org } }),
    () =>
      prisma.project.deleteMany({ where: { workspaceId: fixture.workspace } }),
    () => prisma.member.deleteMany({ where: { organizationId: fixture.org } }),
    () => prisma.workspace.deleteMany({ where: { id: fixture.workspace } }),
    () => prisma.organization.deleteMany({ where: { id: fixture.org } }),
    () =>
      prisma.user.deleteMany({
        where: {
          id: {
            in: [
              fixture.owner,
              fixture.member,
              fixture.outsider,
              fixture.joiner,
            ],
          },
        },
      }),
  ];
  const failures: unknown[] = [];
  for (const step of steps) {
    await step().catch((error: unknown) => failures.push(error));
  }
  if (failures.length > 0) throw failures[0];
}

/**
 * Holds a row lock on another connection until released. The create or
 * reactivation under test waits on it in a statement after its project
 * step, so a project close can start while that step's lock is held.
 */
async function holdRowLock(lockSql: string) {
  if (!url) throw new Error("Missing integration database");
  const client = createPrismaClient(url);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked = () => {};
  const isLocked = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const held = client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(lockSql);
      locked();
      await gate;
    },
    { timeout: 30000 },
  );
  await Promise.race([isLocked, held]);
  return {
    release: async () => {
      release();
      await held;
      await client.$disconnect();
    },
  };
}

/** Waits until `count` statements matching `pattern` block on a lock. */
async function waitForLockWait(pattern: string, count = 1) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query ILIKE ${pattern}`;
    if ((row?.n ?? 0) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No statement waited on a lock: ${pattern}`);
}

function closeProject(fixture: Fixture, projectId: string) {
  return requestProjectClose(
    {
      projectId,
      workspaceId: fixture.workspace,
      actorUserId: fixture.owner,
    },
    { operationId: randomUUID(), expectedProjectRevision: 0 },
  );
}

async function roomState(roomId: string) {
  return prisma.chatRoom.findUniqueOrThrow({
    where: { id: roomId },
    select: {
      organizationId: true,
      kind: true,
      discoverability: true,
      userMembers: { select: { userId: true, access: true } },
      readStates: { select: { userId: true } },
      sokoBotMembers: { select: { sokoBotId: true } },
    },
  });
}

describe.skipIf(!enabled)("shared Soko Bot creation against PostgreSQL", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = newFixture();
    await seed(fixture);
  });

  afterEach(async () => {
    await cleanUp(fixture);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates the bot with its shared room, every member and the bot in it", async () => {
    const bot = await createSharedSokoBot({
      callerUserId: fixture.member,
      workspaceId: fixture.workspace,
      projectId: null,
      name: "Team bot",
      timezone: "Asia/Tokyo",
    });

    expect(bot).toMatchObject({
      ingestTimezone: "Asia/Tokyo",
      userId: null,
      projectId: null,
      createdByUserId: fixture.member,
      workspaceId: fixture.workspace,
    });
    expect(bot.sharedRoomId).not.toBeNull();
    const room = await roomState(bot.sharedRoomId ?? "");
    expect(room).toMatchObject({
      organizationId: fixture.org,
      kind: "channel",
      discoverability: "public",
      sokoBotMembers: [{ sokoBotId: bot.id }],
    });
    const members = [fixture.owner, fixture.member].sort();
    expect(room.userMembers.map((row) => row.userId).sort()).toEqual(members);
    expect(room.userMembers.every((row) => row.access === "member")).toBe(true);
    expect(room.readStates.map((row) => row.userId).sort()).toEqual(members);
  });

  it("creates a project bot only in an open Project of the workspace", async () => {
    const project = await prisma.project.create({
      data: {
        workspaceId: fixture.workspace,
        name: "Launch",
        identifier: "LCH",
      },
    });

    const bot = await createSharedSokoBot({
      callerUserId: fixture.owner,
      workspaceId: fixture.workspace,
      projectId: project.id,
      name: "Launch bot",
    });
    expect(bot.projectId).toBe(project.id);

    await prisma.project.update({
      where: { id: project.id },
      data: { closedAt: new Date() },
    });
    await expect(
      createSharedSokoBot({
        callerUserId: fixture.owner,
        workspaceId: fixture.workspace,
        projectId: project.id,
        name: "Too late",
      }),
    ).rejects.toThrow("The project is not an open project of this workspace");
  });

  // Close sets closingAt and archives the bots; closedAt comes later, when
  // the close finalizes, and nothing archives them again then.
  it("refuses a closing Project on create and on reactivation", async () => {
    const project = await prisma.project.create({
      data: { workspaceId: fixture.workspace, name: "Wind", identifier: "WND" },
    });
    const bot = await createSharedSokoBot({
      callerUserId: fixture.owner,
      workspaceId: fixture.workspace,
      projectId: project.id,
      name: "Wind bot",
    });
    await prisma.sokoBot.update({
      where: { id: bot.id },
      data: { archivedAt: new Date(), status: "PAUSED" },
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { closingAt: new Date() },
    });

    await expect(
      createSharedSokoBot({
        callerUserId: fixture.owner,
        workspaceId: fixture.workspace,
        projectId: project.id,
        name: "Too late",
      }),
    ).rejects.toThrow("The project is not an open project of this workspace");
    await expect(
      reactivateSharedSokoBot(fixture.owner, fixture.workspace, bot.id),
    ).rejects.toThrow(
      "The project is closing or closed, so its Soko Bot stays archived",
    );
    expect(
      await prisma.sokoBot.count({
        where: { projectId: project.id, archivedAt: null },
      }),
    ).toBe(0);
  });

  it("refuses a caller outside the organization and writes nothing", async () => {
    await expect(
      createSharedSokoBot({
        callerUserId: fixture.outsider,
        workspaceId: fixture.workspace,
        projectId: null,
        name: "Intruder",
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(
      await prisma.sokoBot.count({ where: { workspaceId: fixture.workspace } }),
    ).toBe(0);
    expect(
      await prisma.chatRoom.count({ where: { organizationId: fixture.org } }),
    ).toBe(0);
  });

  // A member joins first and holds the trigger's share lock: the creation's
  // organization lock waits, then its member read sees the joiner.
  it("puts a member whose join was in flight into the room", async () => {
    if (!url) throw new Error("Missing integration database");
    const joinClient = createPrismaClient(url);
    let releaseJoin = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseJoin = resolve;
    });
    let joined = () => {};
    const insertDone = new Promise<void>((resolve) => {
      joined = resolve;
    });
    try {
      const join = joinClient.$transaction(
        async (tx) => {
          await addMember(tx, fixture, fixture.joiner, "member");
          joined();
          await gate;
        },
        { timeout: 20000 },
      );
      await Promise.race([insertDone, join]);

      const creation = createSharedSokoBot({
        callerUserId: fixture.owner,
        workspaceId: fixture.workspace,
        projectId: null,
        name: "Race bot",
      });
      const early = await Promise.race([
        creation.then(() => "finished"),
        new Promise((resolve) =>
          setTimeout(() => resolve("blocked"), BLOCKED_PROOF_MS),
        ),
      ]);
      releaseJoin();
      await join;
      const bot = await creation;

      expect(early).toBe("blocked");
      const room = await roomState(bot.sharedRoomId ?? "");
      expect(room.userMembers.map((row) => row.userId)).toContain(
        fixture.joiner,
      );
    } finally {
      releaseJoin();
      await joinClient.$disconnect();
    }
  }, 30000);

  // A member delete takes no organization lock, and its leave trigger cannot
  // see a room that is not committed yet. The create must not add a member
  // who left after its member read.
  it("keeps a member who left during the create out of the room", async () => {
    // The bot insert checks its creator row; holding it parks the create
    // after its member read.
    const hold = await holdRowLock(
      `SELECT id FROM "user" WHERE id = '${fixture.member}' FOR UPDATE`,
    );
    let creation: ReturnType<typeof createSharedSokoBot> | undefined;
    let leave: Promise<number> | undefined;
    try {
      creation = createSharedSokoBot({
        callerUserId: fixture.member,
        workspaceId: fixture.workspace,
        projectId: null,
        name: "Leaver bot",
      });
      await waitForLockWait('%insert into%soko_bot"%');
      leave = prisma.$executeRaw`DELETE FROM member WHERE "userId" = ${fixture.owner} AND "organizationId" = ${fixture.org}`;
      await Promise.race([
        leave,
        new Promise((resolve) => setTimeout(resolve, BLOCKED_PROOF_MS)),
      ]);
    } finally {
      await hold.release();
    }
    const bot = await creation;
    await leave;

    const room = await roomState(bot.sharedRoomId ?? "");
    expect(room.userMembers.map((row) => row.userId)).toEqual([fixture.member]);
    expect(room.readStates.map((row) => row.userId)).toEqual([fixture.member]);
  }, 30000);

  it("reactivates for an owner and puts the bot back into its room", async () => {
    const bot = await createSharedSokoBot({
      callerUserId: fixture.member,
      workspaceId: fixture.workspace,
      projectId: null,
      name: "Team bot",
    });
    const roomId = bot.sharedRoomId ?? "";
    // What archiving leaves: archived, and out of every room.
    await prisma.sokoBot.update({
      where: { id: bot.id },
      data: { archivedAt: new Date(), status: "PAUSED" },
    });
    await prisma.chatRoomSokoBotMember.deleteMany({
      where: { sokoBotId: bot.id },
    });

    await expect(
      reactivateSharedSokoBot(fixture.member, fixture.workspace, bot.id),
    ).rejects.toMatchObject({ status: 403 });

    await reactivateSharedSokoBot(fixture.owner, fixture.workspace, bot.id);

    const after = await prisma.sokoBot.findUniqueOrThrow({
      where: { id: bot.id },
      select: { archivedAt: true, status: true },
    });
    expect(after).toEqual({ archivedAt: null, status: "IDLE" });
    expect((await roomState(roomId)).sokoBotMembers).toEqual([
      { sokoBotId: bot.id },
    ]);
  });
  // The close is SERIALIZABLE and takes its snapshot before it waits on the
  // project row. If the create only locked that row, the close would not see
  // the new bot after the create commits and would leave it live in a
  // closing Project. A write on the row makes the close retry instead.
  it("archives a project bot whose create raced a project close", async () => {
    const project = await prisma.project.create({
      data: { workspaceId: fixture.workspace, name: "Race", identifier: "RCE" },
    });
    // The bot insert checks its creator row; holding it parks the create
    // after its project step.
    const hold = await holdRowLock(
      `SELECT id FROM "user" WHERE id = '${fixture.member}' FOR UPDATE`,
    );
    let creation: ReturnType<typeof createSharedSokoBot> | undefined;
    let close: ReturnType<typeof closeProject> | undefined;
    try {
      creation = createSharedSokoBot({
        callerUserId: fixture.member,
        workspaceId: fixture.workspace,
        projectId: project.id,
        name: "Race bot",
      });
      await waitForLockWait('%insert into%soko_bot"%');
      close = closeProject(fixture, project.id);
      // The close blocks too, behind the create's locks.
      await waitForLockWait("%", 2);
    } finally {
      await hold.release();
    }
    const bot = await creation;
    await close;

    const after = await prisma.sokoBot.findUniqueOrThrow({
      where: { id: bot.id },
      select: { archivedAt: true },
    });
    expect(after.archivedAt).not.toBeNull();
  }, 30000);

  // Close locks the workspace, then the Project. A create that wrote the
  // Project before its bot insert took the workspace key share would wait on
  // the close while the close waits on it: a deadlock. Close queues first on
  // the held workspace row, so it wins that row when it is released.
  it("does not deadlock a create against a close that holds the workspace", async () => {
    const project = await prisma.project.create({
      data: { workspaceId: fixture.workspace, name: "Race", identifier: "RCD" },
    });
    const hold = await holdRowLock(
      `SELECT id FROM workspace WHERE id = '${fixture.workspace}' FOR UPDATE`,
    );
    let creation: Promise<unknown> | undefined;
    let close: ReturnType<typeof closeProject> | undefined;
    try {
      close = closeProject(fixture, project.id);
      await waitForLockWait('%from "workspace"%for update%');
      creation = createSharedSokoBot({
        callerUserId: fixture.member,
        workspaceId: fixture.workspace,
        projectId: project.id,
        name: "Race bot",
      }).catch((error: unknown) => error);
      await waitForLockWait("%", 2);
    } finally {
      await hold.release();
    }
    const created = await creation;
    await close;

    // The close won: the create finds the Project closing and refuses.
    expect(created).toMatchObject({
      message: "The project is not an open project of this workspace",
    });
    expect(
      await prisma.sokoBot.count({ where: { projectId: project.id } }),
    ).toBe(0);
  }, 30000);

  // A deletion soft-deletes a shared bot under its row lock. A reactivation
  // that read the bot before that commit must not bring the tombstone back.
  it("does not reactivate a bot deleted while it waited", async () => {
    const bot = await createSharedSokoBot({
      callerUserId: fixture.member,
      workspaceId: fixture.workspace,
      projectId: null,
      name: "Doomed bot",
    });
    await prisma.sokoBot.update({
      where: { id: bot.id },
      data: { archivedAt: new Date(), status: "PAUSED" },
    });
    await prisma.chatRoomSokoBotMember.deleteMany({
      where: { sokoBotId: bot.id },
    });
    const deletion = await holdRowLock(
      `UPDATE soko_bot SET "deletedAt" = now() WHERE id = '${bot.id}'`,
    );
    let reactivation: Promise<unknown> | undefined;
    try {
      reactivation = reactivateSharedSokoBot(
        fixture.owner,
        fixture.workspace,
        bot.id,
      ).catch((error: unknown) => error);
      await waitForLockWait('%update%soko_bot"%');
    } finally {
      await deletion.release();
    }

    expect(await reactivation).toMatchObject({ message: "Soko Bot not found" });
    const after = await prisma.sokoBot.findUniqueOrThrow({
      where: { id: bot.id },
      select: { archivedAt: true, deletedAt: true },
    });
    expect(after.archivedAt).not.toBeNull();
    expect(after.deletedAt).not.toBeNull();
    expect(
      await prisma.chatRoomSokoBotMember.count({
        where: { sokoBotId: bot.id },
      }),
    ).toBe(0);
  }, 30000);

  it("archives a project bot whose reactivation raced a project close", async () => {
    const project = await prisma.project.create({
      data: { workspaceId: fixture.workspace, name: "Race", identifier: "RCR" },
    });
    const bot = await createSharedSokoBot({
      callerUserId: fixture.member,
      workspaceId: fixture.workspace,
      projectId: project.id,
      name: "Race bot",
    });
    await prisma.sokoBot.update({
      where: { id: bot.id },
      data: { archivedAt: new Date(), status: "PAUSED" },
    });
    await prisma.chatRoomSokoBotMember.deleteMany({
      where: { sokoBotId: bot.id },
    });
    // The participant insert checks its room row; holding it parks the
    // reactivation after its project step and bot update.
    const hold = await holdRowLock(
      `SELECT id FROM chat_room WHERE id = '${bot.sharedRoomId}' FOR UPDATE`,
    );
    let reactivation: ReturnType<typeof reactivateSharedSokoBot> | undefined;
    let close: ReturnType<typeof closeProject> | undefined;
    try {
      reactivation = reactivateSharedSokoBot(
        fixture.owner,
        fixture.workspace,
        bot.id,
      );
      await waitForLockWait('%insert into%chat_room_soko_bot_member"%');
      close = closeProject(fixture, project.id);
      // Without a project write the close does not wait at all.
      await Promise.race([
        close.catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, BLOCKED_PROOF_MS)),
      ]);
    } finally {
      await hold.release();
    }
    await reactivation;
    await close;

    const after = await prisma.sokoBot.findUniqueOrThrow({
      where: { id: bot.id },
      select: { archivedAt: true },
    });
    expect(after.archivedAt).not.toBeNull();
  }, 30000);
});
