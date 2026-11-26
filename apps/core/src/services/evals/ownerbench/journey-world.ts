import { buildOrganizationDriveFilePathname } from "@sokosumi/utils";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import {
  EVAL_CONNECTED_ACCOUNT_PREFIX,
  forgetEvalWorkspaces,
} from "@/lib/evals/eval-guard";
import { EVAL_COWORKER } from "@/lib/evals/fake-coworker";
import { writeOwnerDriveFile } from "@/services/image-studio-drive.service";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { ensureA2aWorld } from "../eval-a2a";
import { seedCmoReports } from "../eval-cmo-runner";
import type { EvalLaneRecord } from "../eval-lanes.service";
import type {
  JourneyCoworker,
  JourneyPrepare,
  JourneyProject,
} from "./journeys";

/**
 * What the owner journeys add to a lane's world: CodePat (a coding
 * Coworker Core answers for, like Mira), the owner's personal Padierfind
 * Project with its X account, and the files a journey hands the bot.
 */

const PADIERFIND = "Padierfind";
const VENDOR_SLUG = "sokosumi-evals";

export interface JourneyWorld {
  coworkers: Record<JourneyCoworker, string>;
  projects: Record<JourneyProject, string>;
  /** The Drive file a journey seeded, and the post it seeded. */
  seededFileId?: string;
  seededPostId?: string;
  /** Schedules seeded on other members' bots, as they were. */
  seededSchedules?: SeededSchedule[];
}

export interface SeededSchedule {
  id: string;
  sokoBotId: string;
  enabled: boolean;
  cronExpression: string;
  prompt: string;
}

const DAY_MS = 86_400_000;

/** Who made which schedule, on whose bot; `ago` is days since the last run. */
const WORKSPACE_SCHEDULES = [
  {
    who: "jami",
    name: "Daily competitor scan",
    cron: "0 8 * * *",
    prompt:
      "Scan cal.com, calendly.com and savvycal.com for news and post a summary.",
    ago: 40,
    failures: 4,
  },
  {
    who: "jami",
    name: "Morning competitor check",
    cron: "30 8 * * 1-5",
    prompt: "Check competitor sites for changes and tell me what moved.",
    ago: 1,
  },
  {
    who: "jami",
    name: "Q3 launch countdown",
    cron: "0 9 * * 1",
    prompt:
      "Remind the team how many days are left until the Q3 launch on September 15.",
    ago: 90,
    enabled: false,
  },
  {
    who: "jami",
    name: "Weekly investor update draft",
    cron: "0 16 * * 5",
    prompt: "Draft the weekly investor update from this week's finished Tasks.",
    ago: 5,
  },
  {
    who: "hannah",
    name: "Research digest",
    cron: "0 9 * * 1",
    prompt: "Summarise last week's research Tasks for Hannah.",
    ago: 3,
  },
  {
    who: "owner",
    name: "Competitor news",
    cron: "0 8 * * *",
    prompt: "Tell me about competitor news from the last day.",
    ago: 1,
  },
  {
    who: "owner",
    name: "Weekday stand-up prep",
    cron: "45 8 * * 1-5",
    prompt: "Prepare my notes for the stand-up from my open Tasks.",
    ago: 1,
  },
] as const;

async function ensureJami(lane: EvalLaneRecord): Promise<string> {
  const email = `evals+lane${lane.lane}-jami@sokosumi.com`;
  const user =
    (await prisma.user.findFirst({ where: { email }, select: { id: true } })) ??
    (await prisma.user.create({
      data: {
        name: "Jami Novak",
        firstName: "Jami",
        lastName: "Novak",
        email,
        emailVerified: true,
        termsAccepted: true,
        notificationsOptIn: false,
        preferredOrganizationId: lane.organizationId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      select: { id: true },
    }));
  await prisma.member.upsert({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: lane.organizationId,
      },
    },
    create: {
      userId: user.id,
      organizationId: lane.organizationId,
      role: "member",
      seatAssignedAt: new Date(),
    },
    update: {},
  });
  return user.id;
}

async function memberBot(
  lane: EvalLaneRecord,
  userId: string,
  name: string,
): Promise<string> {
  const existing = await prisma.sokoBot.findFirst({
    where: { userId, workspaceId: lane.workspaceId, archivedAt: null },
    select: { id: true },
  });
  const id =
    existing?.id ??
    (
      await sokoBotControlPlane.create({
        userId,
        workspaceId: lane.workspaceId,
        name,
      })
    ).id;
  await prisma.sokoBot.update({
    where: { id },
    data: { proactivePaused: true },
  });
  return id;
}

/** The workspace's schedules on three members' bots; a run before leaves none behind. */
async function seedWorkspaceSchedules(
  lane: EvalLaneRecord,
  junoId: string,
): Promise<SeededSchedule[]> {
  const jamiId = await ensureJami(lane);
  const bots = {
    owner: { botId: lane.sokoBotId, userId: lane.userId },
    hannah: { botId: junoId, userId: lane.world.hannahUserId },
    jami: {
      botId: await memberBot(lane, jamiId, "Jami's bot"),
      userId: jamiId,
    },
  };
  const now = await databaseNow();
  const seeded: SeededSchedule[] = [];
  for (const schedule of WORKSPACE_SCHEDULES) {
    const { botId, userId } = bots[schedule.who];
    const row = await prisma.sokoBotSchedule.create({
      data: {
        sokoBotId: botId,
        requestedByUserId: userId,
        workspaceId: lane.workspaceId,
        name: schedule.name,
        enabled: "enabled" in schedule ? schedule.enabled : true,
        timezone: "Europe/Berlin",
        cronExpression: schedule.cron,
        prompt: schedule.prompt,
        createdAt: new Date(now.getTime() - (schedule.ago + 30) * DAY_MS),
        lastRunAt: new Date(now.getTime() - schedule.ago * DAY_MS),
        nextRunAt: new Date(now.getTime() + DAY_MS),
        consecutiveFailures: "failures" in schedule ? schedule.failures : 0,
      },
      select: {
        id: true,
        sokoBotId: true,
        enabled: true,
        cronExpression: true,
        prompt: true,
      },
    });
    seeded.push(row);
  }
  return seeded;
}

/** Other members' seeded schedules go before every journey, so each starts clean. */
async function clearWorkspaceSchedules(lane: EvalLaneRecord): Promise<void> {
  await prisma.sokoBotSchedule.deleteMany({
    where: {
      workspaceId: lane.workspaceId,
      systemKey: null,
      sokoBotId: { not: lane.cusoBotId },
      name: { in: WORKSPACE_SCHEDULES.map((schedule) => schedule.name) },
    },
  });
}

async function ensureCodePat(lane: EvalLaneRecord): Promise<string> {
  const vendor = await prisma.vendor.upsert({
    where: { slug: VENDOR_SLUG },
    create: { slug: VENDOR_SLUG, name: "Sokosumi Evals" },
    update: {},
    select: { id: true },
  });
  const slug = `codepat-evals-${lane.lane}`;
  const coworker = await prisma.coworker.upsert({
    where: { slug },
    create: {
      slug,
      name: "CodePat",
      caption: "Code",
      description:
        "Coding Coworker: reads and reviews the team's source code (the Sokosumi monorepo on GitHub), explains its architecture and writes technical summaries and reviews.",
      baseURL: EVAL_COWORKER.baseURL,
      capabilities: ["tasks", "chat"],
      vendorId: vendor.id,
    },
    update: { archivedAt: null, baseURL: EVAL_COWORKER.baseURL },
    select: { id: true },
  });
  await prisma.coworkerWorkspaceAccess.upsert({
    where: {
      coworkerId_workspaceId: {
        coworkerId: coworker.id,
        workspaceId: lane.workspaceId,
      },
    },
    create: {
      coworkerId: coworker.id,
      workspaceId: lane.workspaceId,
      status: "GRANTED",
    },
    update: { status: "GRANTED" },
  });
  forgetEvalWorkspaces();
  return coworker.id;
}

async function ensurePadierfind(
  lane: EvalLaneRecord,
  withX: boolean,
): Promise<string> {
  const project =
    (await prisma.project.findFirst({
      where: { workspaceId: lane.workspaceId, name: PADIERFIND },
      select: { id: true },
    })) ??
    (await prisma.project.create({
      data: { workspaceId: lane.workspaceId, name: PADIERFIND },
      select: { id: true },
    }));
  const key = `eval-${lane.lane}-padierfind-x`;
  await prisma.projectSocialConnection.deleteMany({
    where: { projectId: project.id },
  });
  if (withX)
    await prisma.projectSocialConnection.create({
      data: {
        projectId: project.id,
        provider: "x",
        externalAccountId: key,
        externalHandle: "padierfind",
        displayName: "Patrick (Padierfind)",
        composioConnectedAccountId: `${EVAL_CONNECTED_ACCOUNT_PREFIX}${lane.lane}:padierfind-x`,
        status: "active",
        activeExternalAccountKey: key,
        connectorUserId: lane.userId,
        connectedAt: new Date(),
      },
    });
  return project.id;
}

async function pdf(title: string, lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText(title, { x: 56, y: 780, size: 20, font: bold });
  lines.forEach((line, index) =>
    page.drawText(line, { x: 56, y: 740 - index * 22, size: 12, font }),
  );
  return doc.save();
}

const LAUNCH_ONE_PAGER = {
  name: "Typed memory launch.pdf",
  title: "Soko Bots now remember properly",
  lines: [
    "Launch: typed memory for every Soko Bot, live today.",
    "- Five sections: Preferences, People, Projects, Follow-ups, Blockers.",
    "- Every entry is dated; a newer fact marks the old one 'Replaced'.",
    "- Nightly dreaming: the bot tidies its memory while you sleep.",
    "- Nothing important is forgotten; old facts never overwrite new ones.",
    "Audience: founders and small teams who run their week with a Soko Bot.",
    "Call to action: open your Soko Bot and ask 'what do you remember about me?'",
  ],
};

const CUSTOMER_STORY = {
  name: "Northwind customer story.pdf",
  title: "Northwind Logistics x Cal.com",
  lines: [
    "Customer: Northwind Logistics, 120 people, Hamburg.",
    "Problem: sales demos were booked by email; 1 in 4 never showed up.",
    "Solution: Cal.com routing forms and automatic reminders.",
    "Result: 43% fewer no-shows in the first quarter.",
    "Result: the sales team saves 11 hours a week on scheduling.",
    "Quote: 'We stopped chasing calendars.' - Lena Fischer, Head of Sales",
  ],
};

async function seedPdf(
  lane: EvalLaneRecord,
  file: { name: string; title: string; lines: string[] },
): Promise<string> {
  const written = await writeOwnerDriveFile({
    workspaceId: lane.workspaceId,
    organizationId: lane.organizationId,
    userId: lane.userId,
    pathname: buildOrganizationDriveFilePathname(
      lane.organizationId,
      file.name,
    ),
    name: file.name,
    bytes: await pdf(file.title, file.lines),
    contentType: "application/pdf",
  });
  if (!written) throw new Error(`Could not seed ${file.name} in Files`);
  return written.id;
}

/** An upcoming Cuso post that still quotes last year's price. */
async function seedOutdatedPricePost(lane: EvalLaneRecord): Promise<string> {
  const now = await databaseNow();
  const template = await prisma.socialPost.findFirst({
    where: {
      projectId: lane.cusoProjectId,
      status: { in: ["SCHEDULED", "DRAFT"] },
      scheduledAt: { gt: now },
    },
    orderBy: { scheduledAt: "asc" },
  });
  if (!template) throw new Error("The Cuso setup has no upcoming post to copy");
  const post = await prisma.socialPost.create({
    data: {
      projectId: template.projectId,
      workspaceId: template.workspaceId,
      socialConnectionId: template.socialConnectionId,
      provider: template.provider,
      text: "Cal.com Teams is just $9 per user a month: round-robin, routing forms and collective events for the whole team. Try it free.",
      status: template.status,
      scheduledAt: new Date(now.getTime() + 3 * 86_400_000),
      timezone: template.timezone,
      creatorSokoBotId: lane.cusoBotId,
      marketingStrategyId: template.marketingStrategyId,
      ...(template.planning === null ? {} : { planning: template.planning }),
    },
    select: { id: true },
  });
  return post.id;
}

/** The journey's world, made fresh before its first step. */
export async function prepareJourneyWorld(
  lane: EvalLaneRecord,
  prepare: readonly JourneyPrepare[],
): Promise<JourneyWorld> {
  const a2a = await ensureA2aWorld(lane);
  const world: JourneyWorld = {
    coworkers: { Mira: a2a.coworkerId, CodePat: await ensureCodePat(lane) },
    projects: {
      Padierfind: await ensurePadierfind(
        lane,
        !prepare.includes("padierfind-without-x"),
      ),
      "Sokosumi Marketing": lane.world.marketingProjectId,
      "utxo AG Outreach": lane.world.outreachProjectId,
      Cuso: lane.cusoProjectId,
    },
  };
  if (prepare.includes("launch-one-pager-pdf"))
    world.seededFileId = await seedPdf(lane, LAUNCH_ONE_PAGER);
  if (prepare.includes("customer-story-pdf"))
    world.seededFileId = await seedPdf(lane, CUSTOMER_STORY);
  if (prepare.includes("outdated-price-post"))
    world.seededPostId = await seedOutdatedPricePost(lane);
  if (prepare.includes("weekly-reports")) await seedCmoReports(lane);
  await clearWorkspaceSchedules(lane);
  if (prepare.includes("workspace-schedules"))
    world.seededSchedules = await seedWorkspaceSchedules(lane, a2a.junoId);
  return world;
}
