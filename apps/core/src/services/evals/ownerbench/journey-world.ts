import { randomUUID } from "node:crypto";
import { buildOrganizationDriveFilePathname } from "@sokosumi/utils";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { channelSlugWithId } from "@/helpers/channel-slug";
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
import { upcomingByNetwork } from "./journey-checks";
import {
  INVESTOR_FIXTURE,
  type JourneyCoworker,
  type JourneyPrepare,
  type JourneyProject,
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
  /** Upcoming Cuso posts seeded on a weekday the owner then rules out. */
  seededWeekdayPostIds?: string[];
  /** Upcoming Cuso posts per network when the journey started. */
  upcomingByNetwork?: Record<string, number>;
  /** Cuso's home room for this journey: its conversation starts empty. */
  cusoRoomId?: string;
}

/**
 * A new home room for the lane's Cuso, made as hiring makes one, so the
 * journey is a new conversation: a shared bot's recent turns are the turns
 * of its room, and the old room keeps the earlier journeys' history. Runs
 * before the Cuso world is prepared, which seeds reports into this room.
 */
export async function freshCusoRoom(
  lane: EvalLaneRecord,
  journeyId: string,
): Promise<string> {
  const name = `Cuso (${journeyId})`;
  const room = await prisma.chatRoom.create({
    data: {
      organizationId: lane.organizationId,
      createdByUserId: lane.userId,
      name,
      slug: channelSlugWithId(name, randomUUID(), "bot"),
      discoverability: "public",
      userMembers: { create: { userId: lane.userId, access: "member" } },
      readStates: { create: { userId: lane.userId } },
      sokoBotMembers: { create: { sokoBotId: lane.cusoBotId } },
    },
    select: { id: true },
  });
  await prisma.sokoBot.update({
    where: { id: lane.cusoBotId },
    data: { sharedRoomId: room.id },
  });
  return room.id;
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
  return seedFile(lane, {
    name: file.name,
    bytes: await pdf(file.title, file.lines),
    contentType: "application/pdf",
  });
}

/** A file in the owner's Files, as an upload puts it there. */
async function seedFile(
  lane: EvalLaneRecord,
  file: { name: string; bytes: Uint8Array; contentType: string },
): Promise<string> {
  const written = await writeOwnerDriveFile({
    workspaceId: lane.workspaceId,
    organizationId: lane.organizationId,
    userId: lane.userId,
    pathname: buildOrganizationDriveFilePathname(
      lane.organizationId,
      file.name,
    ),
    ...file,
  });
  if (!written) throw new Error(`Could not seed ${file.name} in Files`);
  return written.id;
}

/**
 * An upcoming Cuso post like the month's own (same strategy and planning),
 * with this text, network and time.
 */
async function seedUpcomingPost(
  lane: EvalLaneRecord,
  post: { text: string; scheduledAt: Date; provider?: string },
): Promise<string> {
  const template = await prisma.socialPost.findFirst({
    where: {
      projectId: lane.cusoProjectId,
      status: { in: ["SCHEDULED", "DRAFT"] },
      scheduledAt: { gt: await databaseNow() },
    },
    orderBy: { scheduledAt: "asc" },
  });
  if (!template) throw new Error("The Cuso setup has no upcoming post to copy");
  const provider = post.provider ?? template.provider;
  const created = await prisma.socialPost.create({
    data: {
      projectId: template.projectId,
      workspaceId: template.workspaceId,
      socialConnectionId:
        provider === template.provider ? template.socialConnectionId : null,
      provider,
      text: post.text,
      status: template.status,
      scheduledAt: post.scheduledAt,
      timezone: template.timezone,
      creatorSokoBotId: lane.cusoBotId,
      marketingStrategyId: template.marketingStrategyId,
      ...(template.planning === null ? {} : { planning: template.planning }),
    },
    select: { id: true },
  });
  return created.id;
}

/** An upcoming Cuso post that still quotes last year's price. */
async function seedOutdatedPricePost(lane: EvalLaneRecord): Promise<string> {
  return seedUpcomingPost(lane, {
    text: "Cal.com Teams is just $9 per user a month: round-robin, routing forms and collective events for the whole team. Try it free.",
    scheduledAt: new Date((await databaseNow()).getTime() + 3 * DAY_MS),
  });
}

/** 10:00 Berlin (09:00 UTC in winter) on the `count` next days with this weekday. */
function nextWeekdays(from: Date, weekday: number, count: number): Date[] {
  const days: Date[] = [];
  for (let offset = 1; days.length < count; offset += 1) {
    const day = new Date(from.getTime() + offset * DAY_MS);
    if (day.getUTCDay() === weekday)
      days.push(
        new Date(
          Date.UTC(
            day.getUTCFullYear(),
            day.getUTCMonth(),
            day.getUTCDate(),
            9,
          ),
        ),
      );
  }
  return days;
}

/** Two upcoming posts on Fridays and three on LinkedIn: the plan the owner then changes. */
async function seedFridayAndLinkedInPosts(
  lane: EvalLaneRecord,
): Promise<string[]> {
  const now = await databaseNow();
  const fridays = [];
  for (const [index, scheduledAt] of nextWeekdays(now, 5, 2).entries())
    fridays.push(
      await seedUpcomingPost(lane, {
        scheduledAt,
        text: [
          "Friday tip: share one booking link and let Cal.com find the time that works for everyone.",
          "Friday tip: round-robin spreads new meetings fairly across your sales team.",
        ][index] as string,
      }),
    );
  for (const [index, scheduledAt] of [1, 2, 3]
    .flatMap((weekday) => nextWeekdays(now, weekday, 1))
    .entries())
    await seedUpcomingPost(lane, {
      scheduledAt,
      provider: "linkedin",
      text: [
        "How our customers cut scheduling back-and-forth to zero.",
        "Routing forms send every lead to the right person on your team.",
        "Three calendar habits of fast-moving sales teams.",
      ][index] as string,
    });
  return fridays;
}

/** The owner's research notes: every fitting investor, then the two misfits. */
export function investorNotes(): string {
  const months = ["March", "May", "July", "September"];
  const fits = INVESTOR_FIXTURE.fits.map(
    (fit, index) =>
      `- **${fit.fund}** (Europe, seed). Partner: ${fit.partner}. Recent deal: led the seed round of ${fit.startup}, an AI-agent startup, in ${months[index % months.length]} 2026. Source: ${fit.source}`,
  );
  const [bayline, ironforge] = INVESTOR_FIXTURE.misfits;
  return [
    "# Seed investor notes",
    "",
    "Collected for our seed round. All rounds below are from the last 12 months.",
    "",
    ...fits,
    `- **${bayline?.fund}** (San Francisco, Series B only). Partner: ${bayline?.partner}. Recent deal: Series B of ${bayline?.startup}. Source: ${bayline?.source}`,
    `- **${ironforge?.fund}** (Munich, growth stage, no seed). Partner: ${ironforge?.partner}. Recent deal: growth round of ${ironforge?.startup}. Source: ${ironforge?.source}`,
    "",
  ].join("\n");
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
  if (prepare.includes("investor-notes"))
    world.seededFileId = await seedFile(lane, {
      name: "Seed investor notes.md",
      bytes: new TextEncoder().encode(investorNotes()),
      contentType: "text/markdown",
    });
  if (prepare.includes("weekly-reports")) await seedCmoReports(lane);
  if (prepare.includes("friday-and-linkedin-posts"))
    world.seededWeekdayPostIds = await seedFridayAndLinkedInPosts(lane);
  world.upcomingByNetwork = await upcomingByNetwork(
    lane.cusoProjectId,
    await databaseNow(),
  );
  await clearWorkspaceSchedules(lane);
  if (prepare.includes("workspace-schedules"))
    world.seededSchedules = await seedWorkspaceSchedules(lane, a2a.junoId);
  return world;
}
