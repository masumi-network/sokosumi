import { randomUUID } from "node:crypto";
import {
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { del } from "@vercel/blob";
import { z } from "zod";
import { getEnv } from "@/config/env";
import { getCredits } from "@/helpers/user";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  EVAL_CONNECTED_ACCOUNT_PREFIX,
  forgetEvalWorkspaces,
} from "@/lib/evals/eval-guard";
import { tombstoneDriveUploadResources } from "@/services/file-catalog.service";
import { freeCreditAdminService } from "@/services/free-credit-admin.service";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { getDefaultSokoBotVersionId } from "@/services/soko-bot-version.service";

/**
 * Eval lanes: one eval organization per lane, each a small, fixed world the
 * Soko Bot scenarios expect — an owner with two teammates (Hannah does
 * research, Alex writes), two Projects with an X and a LinkedIn account, a
 * newsletter, a team room — plus a Cuso Project the CMO cases point at a
 * brand. Repeat N of a run uses lane N, so repeats run side by side.
 *
 * Nobody signs in to a lane. Its bots are paused for unprompted work, so the
 * crons never wake them; eval turns start with `lab:`, which keeps them out
 * of the daily allowance like behaviour-lab turns.
 */

export const EVAL_LANE_COUNT = 3;
/** Topped up before each run; a full daily run spends a fraction of this. */
const LANE_CREDITS = 2_000;
const EMAIL_DOMAIN = "sokosumi.com";

const worldSchema = z.object({
  hannahUserId: z.string(),
  alexUserId: z.string(),
  marketingProjectId: z.string(),
  outreachProjectId: z.string(),
  roomId: z.string(),
});
export type EvalWorld = z.infer<typeof worldSchema>;

export interface EvalLaneRecord {
  lane: number;
  userId: string;
  organizationId: string;
  workspaceId: string;
  sokoBotId: string;
  cusoBotId: string;
  cusoProjectId: string;
  world: EvalWorld;
}

function laneEmail(lane: number, who: string) {
  return `evals+lane${lane}${who === "owner" ? "" : `-${who}`}@${EMAIL_DOMAIN}`;
}

async function ensureUser(lane: number, who: string, name: string) {
  const email = laneEmail(lane, who);
  const existing = await prisma.user.findFirst({
    where: { email },
    select: { id: true },
  });
  if (existing) return existing.id;
  const now = new Date();
  const [firstName, lastName] = name.split(" ");
  const user = await prisma.user.create({
    data: {
      name,
      firstName,
      lastName,
      email,
      emailVerified: true,
      termsAccepted: true,
      notificationsOptIn: false,
      createdAt: now,
      updatedAt: now,
    },
    select: { id: true },
  });
  return user.id;
}

const SEED_MESSAGES = [
  {
    who: "hannah",
    content:
      "Morning! I pulled pricing pages for three of the EU agent marketplaces yesterday, two more to go.",
  },
  {
    who: "alex",
    content:
      "Nice. Once the research is in I can turn it into the one-page brief for the launch.",
  },
  {
    who: "owner",
    content:
      "Great. Launch copy is still open, let's settle the headline by Thursday.",
  },
] as const;

async function createWorld(input: {
  lane: number;
  ownerId: string;
  hannahId: string;
  alexId: string;
  organizationId: string;
  workspaceId: string;
  sokoBotId: string;
}): Promise<EvalWorld> {
  const [marketing, outreach] = await Promise.all(
    ["Sokosumi Marketing", "utxo AG Outreach"].map((name) =>
      prisma.project.create({
        data: { workspaceId: input.workspaceId, name },
        select: { id: true },
      }),
    ),
  );
  const now = new Date();
  await prisma.projectSocialConnection.createMany({
    data: [
      {
        projectId: marketing.id,
        provider: "x",
        handle: "sokosumi",
        name: "Sokosumi",
      },
      {
        projectId: outreach.id,
        provider: "linkedin",
        handle: "utxo-ag",
        name: "utxo AG",
      },
    ].map((account) => ({
      projectId: account.projectId,
      provider: account.provider,
      externalAccountId: `eval-${input.lane}-${account.provider}`,
      externalHandle: account.handle,
      displayName: account.name,
      composioConnectedAccountId: `${EVAL_CONNECTED_ACCOUNT_PREFIX}${input.lane}:${account.provider}`,
      status: "active",
      activeExternalAccountKey: `eval-${input.lane}-${account.provider}`,
      connectorUserId: input.ownerId,
      connectedAt: now,
    })),
  });
  await prisma.newsletter.create({
    data: {
      projectId: marketing.id,
      workspaceId: input.workspaceId,
      name: "Sokosumi Updates",
      senderName: "Sokosumi",
      replyTo: laneEmail(input.lane, "owner"),
      publicSlug: `sokosumi-evals-${input.lane}-${randomUUID().slice(0, 8)}`,
    },
  });
  const room = await prisma.chatRoom.create({
    data: {
      organizationId: input.organizationId,
      name: "Launch team",
      slug: "launch-team",
      createdByUserId: input.ownerId,
      userMembers: {
        create: [input.ownerId, input.hannahId, input.alexId].map((userId) => ({
          userId,
        })),
      },
      sokoBotMembers: { create: { sokoBotId: input.sokoBotId } },
    },
    select: { id: true },
  });
  const senders = {
    owner: input.ownerId,
    hannah: input.hannahId,
    alex: input.alexId,
  };
  for (const [index, message] of SEED_MESSAGES.entries()) {
    await prisma.chatRoomMessage.create({
      data: {
        roomId: room.id,
        senderUserId: senders[message.who],
        content: message.content,
        createdAt: new Date(
          now.getTime() - (SEED_MESSAGES.length - index) * 60_000,
        ),
      },
    });
  }
  return {
    hannahUserId: input.hannahId,
    alexUserId: input.alexId,
    marketingProjectId: marketing.id,
    outreachProjectId: outreach.id,
    roomId: room.id,
  };
}

async function createLane(lane: number): Promise<EvalLaneRecord> {
  const ownerId = await ensureUser(lane, "owner", "Robin Keller");
  const hannahId = await ensureUser(lane, "hannah", "Hannah Weber");
  const alexId = await ensureUser(lane, "alex", "Alex Kim");
  const slug = `sokosumi-evals-${lane}`;
  const now = new Date();
  const organization =
    (await prisma.organization.findUnique({
      where: { slug },
      select: { id: true, workspace: { select: { id: true } } },
    })) ??
    (await prisma.organization.create({
      data: {
        name: `Sokosumi Evals ${lane}`,
        slug,
        members: {
          create: [
            { userId: ownerId, role: "owner", seatAssignedAt: now },
            { userId: hannahId, role: "member", seatAssignedAt: now },
            { userId: alexId, role: "member", seatAssignedAt: now },
          ],
        },
        workspace: { create: {} },
      },
      select: { id: true, workspace: { select: { id: true } } },
    }));
  const workspaceId = organization.workspace?.id;
  if (!workspaceId) throw new Error(`Eval lane ${lane} has no workspace`);
  await prisma.user.updateMany({
    where: { id: { in: [ownerId, hannahId, alexId] } },
    data: { preferredOrganizationId: organization.id },
  });
  // Counted as an eval workspace before its bots exist: nothing they do may
  // reach a global Coworker, not even while the lane is being set up.
  await prisma.evalLane.upsert({
    where: { lane },
    create: {
      lane,
      userId: ownerId,
      organizationId: organization.id,
      workspaceId,
      sokoBotId: randomUUID(),
      world: {},
    },
    update: {
      userId: ownerId,
      organizationId: organization.id,
      workspaceId,
    },
  });
  forgetEvalWorkspaces();

  const bot = await sokoBotControlPlane.create({
    userId: ownerId,
    workspaceId,
    name: "Soko",
  });
  await prisma.sokoBot.update({
    where: { id: bot.id },
    data: { proactivePaused: true, ingestTimezone: "Europe/Berlin" },
  });
  const world = await createWorld({
    lane,
    ownerId,
    hannahId,
    alexId,
    organizationId: organization.id,
    workspaceId,
    sokoBotId: bot.id,
  });

  const cusoProject = await prisma.project.create({
    data: { workspaceId, name: "Eval brand", websiteUrl: "https://cal.com" },
    select: { id: true },
  });
  const { createSharedSokoBot } = await import(
    "@/services/soko-bot-shared-create.service"
  );
  const cuso = await createSharedSokoBot({
    callerUserId: ownerId,
    workspaceId,
    projectId: cusoProject.id,
    name: "Cuso",
    versionId: CMO_SOKO_BOT_VERSION_ID,
    timezone: "Europe/Berlin",
  });
  await prisma.sokoBot.update({
    where: { id: cuso.id },
    data: { proactivePaused: true },
  });

  const row = await prisma.evalLane.update({
    where: { lane },
    data: {
      sokoBotId: bot.id,
      cusoBotId: cuso.id,
      cusoProjectId: cusoProject.id,
      world,
    },
  });
  return toRecord(row);
}

function toRecord(row: {
  lane: number;
  userId: string;
  organizationId: string;
  workspaceId: string;
  sokoBotId: string;
  cusoBotId: string | null;
  cusoProjectId: string | null;
  world: unknown;
}): EvalLaneRecord {
  const world = worldSchema.safeParse(row.world);
  if (!world.success || !row.cusoBotId || !row.cusoProjectId)
    throw new Error(`Eval lane ${row.lane} is incomplete`);
  return {
    lane: row.lane,
    userId: row.userId,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    sokoBotId: row.sokoBotId,
    cusoBotId: row.cusoBotId,
    cusoProjectId: row.cusoProjectId,
    world: world.data,
  };
}

/**
 * The lanes a run needs, made on first use. A lane whose setup stopped
 * halfway is made again from what exists: users and the organization are
 * found by their fixed emails and slug.
 */
export async function ensureEvalLanes(
  count: number,
): Promise<EvalLaneRecord[]> {
  const lanes: EvalLaneRecord[] = [];
  for (let lane = 1; lane <= count; lane += 1) {
    const row = await prisma.evalLane.findUnique({ where: { lane } });
    const bot = row
      ? await prisma.sokoBot.findFirst({
          where: { id: row.sokoBotId, archivedAt: null, deletedAt: null },
          select: { id: true },
        })
      : null;
    lanes.push(
      row && bot && row.cusoBotId ? toRecord(row) : await createLane(lane),
    );
  }
  return lanes;
}

export async function getEvalLane(lane: number): Promise<EvalLaneRecord> {
  return toRecord(await prisma.evalLane.findUniqueOrThrow({ where: { lane } }));
}

/**
 * Before a run: the lane's bots on the versions under test, out of any turn
 * a stopped run left, with credits for the day.
 */
export async function prepareEvalLane(
  lane: EvalLaneRecord,
  versions: { sokoBot: string; cuso: string },
): Promise<void> {
  await prisma.sokoBot.update({
    where: { id: lane.sokoBotId },
    data: { versionId: versions.sokoBot, proactivePaused: true },
  });
  await prisma.sokoBot.update({
    where: { id: lane.cusoBotId },
    data: {
      versionId: versions.cuso,
      // Research, plans and production are turns Core starts for Cuso, which
      // a pause refuses. He is paused again when the run ends.
      proactivePaused: false,
      // The owner's daily brake would stop a CMO case partway.
      proactiveDailyLimit: 1_000,
    },
  });
  await prisma.sokoBotTurn.updateMany({
    where: {
      sokoBotId: { in: [lane.sokoBotId, lane.cusoBotId] },
      status: { in: ["QUEUED", "STARTING", "RUNNING", "CANCEL_REQUESTED"] },
    },
    data: {
      status: "FAILED",
      errorKind: "eval_run_stopped",
      completedAt: new Date(),
    },
  });
  const balance = await getCredits(null, lane.organizationId);
  if (balance < LANE_CREDITS / 2) {
    await freeCreditAdminService.grantFreeCredits({
      target: { targetType: "organization", targetId: lane.organizationId },
      credits: Math.ceil(LANE_CREDITS - balance),
      ttlDays: 30,
      referenceNote: `Eval lane ${lane.lane}`,
    });
  }
}

/** The Soko Bot and Cuso of the first `count` lanes. */
export async function evalLaneBotIds(count: number): Promise<string[]> {
  const lanes = await prisma.evalLane.findMany({
    where: { lane: { lte: count } },
    select: { sokoBotId: true, cusoBotId: true },
  });
  return lanes.flatMap((lane) =>
    lane.cusoBotId ? [lane.sokoBotId, lane.cusoBotId] : [lane.sokoBotId],
  );
}

/** Between runs nothing wakes a lane's bots: crons skip paused bots. */
export async function pauseEvalLanes(count: number): Promise<void> {
  await prisma.sokoBot.updateMany({
    where: { id: { in: await evalLaneBotIds(count) } },
    data: { proactivePaused: true },
  });
}

/** The versions eval bots run unless a run names others. */
export async function defaultEvalVersions() {
  return {
    sokoBot: await getDefaultSokoBotVersionId(),
    cuso: CMO_SOKO_BOT_VERSION_ID,
  };
}

/** Check persisted tenant ownership before any destructive fixture reset. */
async function resetEvalTables(lane: EvalLaneRecord): Promise<void> {
  await serializableTransaction(async (tx) => {
    const registered = await tx.evalLane.findFirst({
      where: {
        lane: lane.lane,
        userId: lane.userId,
        organizationId: lane.organizationId,
        workspaceId: lane.workspaceId,
        sokoBotId: lane.sokoBotId,
        cusoBotId: lane.cusoBotId,
      },
    });
    if (!registered) throw new Error("Registered eval lane required");
    const tenant = await tx.workspace.findFirst({
      where: {
        id: registered.workspaceId,
        organizationId: registered.organizationId,
        organization: {
          slug: `sokosumi-evals-${registered.lane}`,
          members: { some: { userId: registered.userId, role: "owner" } },
        },
      },
      select: { id: true },
    });
    // Eval runs never wake the personal bot through crons. Keep it paused
    // while removing its previous world's tables and retry keys.
    const bot =
      tenant &&
      (await tx.sokoBot.updateMany({
        where: {
          id: registered.sokoBotId,
          userId: registered.userId,
          workspaceId: registered.workspaceId,
          deletedAt: null,
          archivedAt: null,
        },
        data: { proactivePaused: true },
      }));
    if (!bot?.count) throw new Error("Registered eval lane required");
    const world = worldSchema.parse(registered.world);
    const tableWhere = {
      workspaceId: registered.workspaceId,
      createdBy: {
        in: [
          registered.sokoBotId,
          ...(registered.cusoBotId ? [registered.cusoBotId] : []),
          registered.userId,
          world.hannahUserId,
          world.alexUserId,
        ],
      },
    };
    const tables = await tx.dataTable.findMany({
      where: tableWhere,
      select: { id: true },
    });
    await tx.fileResource.updateMany({
      where: {
        workspaceId: registered.workspaceId,
        sourceKind: FileSourceKind.NATIVE_TABLE,
        sourceId: { in: tables.map((table) => table.id) },
        tombstonedAt: null,
      },
      data: {
        lifecycle: FileResourceLifecycle.TOMBSTONED,
        tombstonedAt: new Date(),
        aclRevision: { increment: 1 },
      },
    });
    // TableOperation cascades with its table. Historical turns, tool calls,
    // eval results and their recorded outputs have no such cascade.
    await tx.dataTable.deleteMany({ where: tableWhere });
  }, "Eval fixture reset conflicted; retry the reset");
}

/**
 * Back to the seeded world before the Soko Bot cases: what earlier eval turns
 * made (Tasks, schedules, posts in the room, Drive files, drafts, contacts, tables)
 * goes, and memory starts empty. The seeded Projects, people and room stay.
 */
export async function resetEvalLaneForSokoBot(
  lane: EvalLaneRecord,
): Promise<void> {
  await resetEvalTables(lane);
  const { workspaceId, sokoBotId } = lane;
  await prisma.task.updateMany({
    where: { workspaceId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  await prisma.sokoBotSchedule.deleteMany({
    where: { sokoBotId, systemKey: null },
  });
  await prisma.chatRoomMessage.updateMany({
    where: {
      room: { organizationId: lane.organizationId },
      senderSokoBotId: { not: null },
      deletedAt: null,
    },
    data: { deletedAt: new Date() },
  });
  // Every Drive upload in the lane: an upload finds an earlier file by
  // listing the blob store, so the blob goes as well as its catalog entry.
  const uploads = await prisma.fileResource.findMany({
    where: {
      workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      tombstonedAt: null,
    },
    select: { sourceId: true, sourceScope: true },
  });
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (uploads.length && token)
    await del(
      uploads.map((upload) => upload.sourceId),
      { token },
    ).catch(() => undefined);
  for (const upload of uploads)
    await tombstoneDriveUploadResources({
      workspaceId,
      scope:
        upload.sourceScope === FileSourceScope.ORGANIZATION
          ? "organization"
          : "user",
      pathnames: [upload.sourceId],
    });
  await prisma.socialPost.deleteMany({ where: { workspaceId } });
  await prisma.newsletterIssue.deleteMany({ where: { workspaceId } });
  await prisma.contact.deleteMany({ where: { workspaceId } });
  await sokoBotControlPlane.resetMemory(lane.userId, workspaceId);
}
