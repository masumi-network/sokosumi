import { randomUUID } from "node:crypto";
import { FileSourceKind, FileSourceScope } from "@sokosumi/database";
import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { z } from "zod";
import { jsonInput } from "@/helpers/prisma-json";
import { getCredits } from "@/helpers/user";
import prisma from "@/lib/db/prisma";
import { driveDel } from "@/lib/drive-blob";
import {
  EVAL_CONNECTED_ACCOUNT_PREFIX,
  forgetEvalWorkspaces,
} from "@/lib/evals/eval-guard";
import { seedEvalMcpServer } from "@/lib/evals/eval-mcp-server";
import { tombstoneDriveUploadResources } from "@/services/file-catalog.service";
import { freeCreditAdminService } from "@/services/free-credit-admin.service";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { getDefaultSokoBotVersionId } from "@/services/soko-bot-version.service";
import { closeA2aWorld } from "./eval-a2a";

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
      lastName: lastName ?? null,
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
      world: jsonInput(world),
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

/**
 * Back to the seeded world before the Soko Bot cases: what earlier eval turns
 * made (Tasks, schedules, posts in the room, Drive files, drafts, contacts)
 * goes, and memory starts empty. The seeded Projects, people and room stay.
 */
function evalXAccountId(sokoBotId: string): string {
  return `${EVAL_CONNECTED_ACCOUNT_PREFIX}x-dms:${sokoBotId}`;
}

/**
 * A stand-in X connection holding only the DMs a case gives, as contact
 * capture keeps them: the ingest, stand-up and search_inbox read them, and
 * nothing ever calls X for it.
 */
export async function seedEvalXDms(
  lane: EvalLaneRecord,
  dms: readonly {
    from: string;
    text: string;
    minutesAgo: number;
    conversation: string;
    fromOwner?: boolean;
  }[],
): Promise<void> {
  const now = Date.now();
  const cursor = {
    xDms: dms.map((dm, index) => ({
      id: `eval-dm-${index + 1}`,
      conversationId: dm.conversation,
      from: dm.fromOwner ? "Robin Keller (@robinkeller)" : dm.from,
      createdAt: new Date(now - dm.minutesAgo * 60_000).toISOString(),
      text: dm.text,
      fromOwner: dm.fromOwner ?? false,
    })),
  };
  const composioAccountId = evalXAccountId(lane.sokoBotId);
  await prisma.sokoBotIntegration.upsert({
    where: { composioAccountId },
    create: {
      sokoBotId: lane.sokoBotId,
      provider: "twitter",
      name: "X",
      composioAccountId,
      status: "ACTIVE",
      connectedAt: new Date(now),
      cursor,
    },
    update: { status: "ACTIVE", cursor },
  });
}

/**
 * What earlier benchmark cases made in the lane, known by who made it, not
 * by its title: Tasks and Task Schedules (with their Runs) a bot created, the
 * Cuso Project's posts a bot created, and every Drive upload (an earlier
 * case's evidence PDF or a file a bot saved). A case that starts after this sees
 * none of them in its first context. A member's Tasks and schedules (the
 * owner's seeded board) stay; a case's setup seeds its own posts and
 * strategy after this runs.
 */
export async function clearEarlierCaseArtifacts(
  lane: Pick<EvalLaneRecord, "workspaceId" | "cusoProjectId">,
  deleteBlobs?: DeleteBlobs,
): Promise<{ blobsPending: string[] }> {
  const botMade = {
    workspaceId: lane.workspaceId,
    creatorSokoBotId: { not: null },
  };
  await prisma.task.updateMany({
    where: {
      archivedAt: null,
      OR: [botMade, { schedule: botMade }],
    },
    data: { archivedAt: new Date() },
  });
  await prisma.taskSchedule.deleteMany({ where: botMade });
  await prisma.socialPost.deleteMany({
    where: { projectId: lane.cusoProjectId, creatorSokoBotId: { not: null } },
  });
  return removeLaneUploads(lane, deleteBlobs);
}

/**
 * Every Drive upload in the lane, which is every file in its Files and its
 * Projects' files: an earlier case's evidence PDF, a file a bot saved, an
 * upload. Nothing on a lane is shared seed; each case's prepare writes its
 * own files after this. An upload finds an earlier file by listing the blob
 * store, so the blob goes as well as its catalog entry.
 */
export async function removeLaneUploads(
  lane: Pick<EvalLaneRecord, "workspaceId">,
  deleteBlobs: DeleteBlobs = deleteFromBlobStore,
): Promise<{ blobsPending: string[] }> {
  const { workspaceId } = lane;
  const uploads = await prisma.fileResource.findMany({
    where: {
      workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      tombstonedAt: null,
    },
    select: { sourceId: true, sourceScope: true },
  });
  // The catalog entry goes first: the bot can't list or read a file whose
  // blob is still being deleted.
  for (const upload of uploads)
    await tombstoneDriveUploadResources({
      workspaceId,
      scope:
        upload.sourceScope === FileSourceScope.ORGANIZATION
          ? "organization"
          : "user",
      pathnames: [upload.sourceId],
    });
  const pendingKey = `${PENDING_BLOB_PREFIX}${workspaceId}:`;
  const earlier = await prisma.syncMetadata.findMany({
    where: { key: { startsWith: pendingKey } },
    select: { key: true },
  });
  const pathnames = [
    ...new Set([
      ...earlier.map((row) => row.key.slice(pendingKey.length)),
      ...uploads.map((upload) => upload.sourceId),
    ]),
  ];
  if (!pathnames.length) return { blobsPending: [] };
  const deleted = await retried(() => deleteBlobs(pathnames));
  // A blob still there would be found by a later upload of the same name:
  // its pathname waits for the next reset to delete it.
  if (deleted)
    await prisma.syncMetadata.deleteMany({
      where: {
        key: { in: pathnames.map((pathname) => pendingKey + pathname) },
      },
    });
  else
    for (const pathname of pathnames)
      await prisma.syncMetadata.upsert({
        where: { key: pendingKey + pathname },
        create: { key: pendingKey + pathname, lastSyncedAt: new Date() },
        update: { lastSyncedAt: new Date() },
      });
  return { blobsPending: deleted ? [] : pathnames };
}

/** Deletes these blobs; resolves when they are gone, rejects when they may not be. */
export type DeleteBlobs = (pathnames: string[]) => Promise<void>;

/** Where a reset that could not delete a lane's blob keeps its pathname. */
export const PENDING_BLOB_PREFIX = "eval-lane-blob-pending:";

// Every store the pathname may live in (a data room's private one too). With
// no store configured it rejects, so the pathname stays pending.
const deleteFromBlobStore: DeleteBlobs = (pathnames) => driveDel(pathnames);

/** Up to three tries, 200 ms then 800 ms apart; whether one succeeded. */
async function retried(work: () => Promise<void>): Promise<boolean> {
  for (const [attempt, wait] of [200, 800, 0].entries()) {
    try {
      await work();
      return true;
    } catch {
      if (attempt < 2)
        await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  return false;
}

export async function resetEvalLaneForSokoBot(
  lane: EvalLaneRecord,
): Promise<{ blobsPending: string[] }> {
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
  const uploads = await removeLaneUploads(lane);
  await prisma.socialPost.deleteMany({ where: { workspaceId } });
  await prisma.newsletterIssue.deleteMany({ where: { workspaceId } });
  await prisma.contact.deleteMany({ where: { workspaceId } });
  await prisma.sokoBotIntegration.deleteMany({
    where: { sokoBotId, composioAccountId: evalXAccountId(sokoBotId) },
  });
  await sokoBotControlPlane.resetMemory(lane.userId, workspaceId);
  await seedEvalMcpServer(lane);
  await closeA2aWorld(lane);
  return uploads;
}
