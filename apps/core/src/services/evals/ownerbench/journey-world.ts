import { randomUUID } from "node:crypto";
import {
  buildOrganizationDriveFilePathname,
  convertCreditsToCents,
} from "@sokosumi/utils";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { channelSlugWithId } from "@/helpers/channel-slug";
import { databaseNow } from "@/lib/db/database-now";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { evalEnvironment } from "@/lib/evals/eval-environment";
import { forgetEvalWorkspaces } from "@/lib/evals/eval-guard";
import { EVAL_CONNECTED_ACCOUNT_PREFIX } from "@/lib/evals/eval-social-account";
import { EVAL_COWORKER } from "@/lib/evals/fake-coworker";
import { DETACHED_SOKO_BOT_NETWORK } from "@/lib/network";
import { writeOwnerDriveFile } from "@/services/image-studio-drive.service";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { ensureA2aWorld } from "../eval-a2a";
import { seedCmoReports } from "../eval-cmo-runner";
import type { EvalLaneRecord } from "../eval-lanes.service";
import { mediaPathnames, upcomingByNetwork } from "./journey-checks";
import {
  type FixturePicturePost,
  type FixtureTask,
  INVESTOR_FIXTURE,
  investorLine,
  type JourneyCoworker,
  type JourneyFixtures,
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
  /** A phrase only the seeded file's text holds: a read must return it. */
  seededFileMarker?: string;
  seededPostId?: string;
  /** Schedules seeded on other members' bots, as they were. */
  seededSchedules?: SeededSchedule[];
  /** Upcoming Cuso posts seeded on a weekday the owner then rules out. */
  seededWeekdayPostIds?: string[];
  /** Upcoming Cuso posts per network when the journey started. */
  upcomingByNetwork?: Record<string, number>;
  /** Cuso's home room for this journey: its conversation starts empty. */
  cusoRoomId?: string;
  /**
   * When the lane was cleared for this journey, before its prepare: a file
   * made before then is an earlier case's, one made after is this journey's.
   */
  isolatedAt?: string;
  /** The room the owner, the teammates and the owner's bot share. */
  teammateRoomId?: string;
  /** Cuso's published posts when the journey started. */
  seededPublished?: { id: string; text: string; pathnames: string[] }[];
  /** The target picture post's text and picture, and the other seeded posts' pictures. */
  seededPicture?: {
    postId: string;
    text: string;
    pathname: string;
    others: { postId: string; pathnames: string[] }[];
  };
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
        network: DETACHED_SOKO_BOT_NETWORK,
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
  return [
    "# Seed investor notes",
    "",
    "Collected for our seed round. All rounds below are from the last 12 months.",
    "",
    ...[...INVESTOR_FIXTURE.fits, ...INVESTOR_FIXTURE.misfits].map(
      (investor) => `- ${investorLine(investor)}`,
    ),
    "",
  ].join("\n");
}

function needs<T>(value: T | undefined, prepare: JourneyPrepare): T {
  if (value === undefined)
    throw new Error(`The prepare "${prepare}" needs its journey fixtures`);
  return value;
}

/** The fixture's Tasks for the owner; earlier ones of the same names are archived first. */
async function seedTasks(
  lane: EvalLaneRecord,
  miraId: string,
  tasks: readonly FixtureTask[],
): Promise<void> {
  const now = await databaseNow();
  await prisma.task.updateMany({
    where: {
      workspaceId: lane.workspaceId,
      name: { in: tasks.map((task) => task.name) },
    },
    data: { archivedAt: now },
  });
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const berlinDay = (days: number) =>
    new Date(
      `${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(ago(-days))}T00:00:00Z`,
    );
  for (const fixture of tasks) {
    const task = await prisma.task.create({
      data: {
        name: fixture.name,
        status: fixture.status,
        workspaceId: lane.workspaceId,
        organizationId: lane.organizationId,
        ownerId: lane.userId,
        creatorUserId: lane.userId,
        ...(fixture.assignee === "Mira" ? { assigneeId: miraId } : {}),
        ...(fixture.assignee === "owner"
          ? { assigneeUserId: lane.userId }
          : {}),
        ...(fixture.dueInDays === undefined
          ? {}
          : { dueOn: berlinDay(fixture.dueInDays) }),
        createdAt: ago(fixture.createdDaysAgo),
        updatedAt: ago(fixture.touchedDaysAgo),
      },
      select: { id: true },
    });
    if (fixture.question)
      await prisma.taskEvent.create({
        data: {
          taskId: task.id,
          status: fixture.status,
          comment: fixture.question,
          ...(fixture.assignee === "Mira"
            ? { coworkerId: miraId }
            : { userId: lane.userId }),
          createdAt: ago(fixture.touchedDaysAgo),
        },
      });
  }
}

/** A new room the owner, Hannah, Alex and the journey's bot share, so its history starts empty. */
export async function seedTeammateRoom(
  lane: EvalLaneRecord,
  botId: string,
): Promise<string> {
  const name = "Team room";
  const members = [lane.userId, lane.world.hannahUserId, lane.world.alexUserId];
  const room = await prisma.chatRoom.create({
    data: {
      organizationId: lane.organizationId,
      createdByUserId: lane.userId,
      name,
      slug: channelSlugWithId(name, randomUUID(), "room"),
      discoverability: "public",
      userMembers: {
        create: members.map((userId) => ({ userId, access: "member" })),
      },
      readStates: { create: members.map((userId) => ({ userId })) },
      sokoBotMembers: { create: { sokoBotId: botId } },
    },
    select: { id: true },
  });
  return room.id;
}

/** The Cuso post fields every seeded upcoming post shares. */
async function cusoPostBase(lane: EvalLaneRecord) {
  const strategy = await prisma.marketingStrategy.findFirst({
    where: { projectId: lane.cusoProjectId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const connections = await prisma.projectSocialConnection.findMany({
    where: { projectId: lane.cusoProjectId },
    select: { id: true, provider: true },
  });
  return (provider: string) => ({
    projectId: lane.cusoProjectId,
    workspaceId: lane.workspaceId,
    creatorSokoBotId: lane.cusoBotId,
    marketingStrategyId: strategy?.id ?? null,
    provider,
    socialConnectionId:
      connections.find((connection) => connection.provider === provider)?.id ??
      null,
    timezone: "Europe/Berlin",
  });
}

const MONTH_TOPICS = [
  "Share one booking link and let the calendar find the time.",
  "Round-robin spreads new meetings fairly across the team.",
  "Routing forms send every lead to the right person.",
  "Buffer times keep back-to-back calls from piling up.",
];

/** Cuso's upcoming posts replaced by the fixture's SCHEDULED ones, one a day; published ones stay. */
async function seedScheduledPosts(
  lane: EvalLaneRecord,
  fixture: NonNullable<JourneyFixtures["scheduledPosts"]>,
): Promise<void> {
  const now = await databaseNow();
  await prisma.socialPost.deleteMany({
    where: { projectId: lane.cusoProjectId, status: { not: "PUBLISHED" } },
  });
  const base = await cusoPostBase(lane);
  for (let index = 0; index < fixture.count; index += 1)
    await prisma.socialPost.create({
      data: {
        ...base(fixture.providers[index % fixture.providers.length] ?? "x"),
        text: `${MONTH_TOPICS[index % MONTH_TOPICS.length]} (${index + 1})`,
        status: "SCHEDULED",
        scheduledAt: new Date(now.getTime() + (index + 1) * DAY_MS),
      },
    });
}

function pictureSvg(text: string): Uint8Array {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="1200" height="1200" fill="#111"/><text x="80" y="600" font-size="64" fill="#fff">${escaped}</text></svg>`,
  );
}

/** Writes a picture to the owner's Files and returns its pathname. */
type SaveImage = (
  lane: EvalLaneRecord,
  file: { name: string; bytes: Uint8Array },
) => Promise<string>;

const saveImageToFiles: SaveImage = async (lane, file) => {
  const id = await seedFile(lane, { ...file, contentType: "image/svg+xml" });
  const row = await prisma.fileResource.findUniqueOrThrow({
    where: { id },
    select: { sourceId: true },
  });
  return row.sourceId;
};

/** The fixture's upcoming Cuso posts, each with its picture in Files; the target is the one checks follow. */
export async function seedPicturePosts(
  lane: EvalLaneRecord,
  posts: readonly FixturePicturePost[],
  saveImage: SaveImage = saveImageToFiles,
): Promise<NonNullable<JourneyWorld["seededPicture"]>> {
  const targets = posts.filter((post) => post.target);
  if (targets.length !== 1)
    throw new Error("picture-posts needs exactly one target post");
  const now = await databaseNow();
  const base = await cusoPostBase(lane);
  const seeded = [];
  for (const post of posts) {
    const name = `${randomUUID().slice(0, 8)}.svg`;
    const bytes = pictureSvg(post.pictureText);
    const pathname = await saveImage(lane, { name, bytes });
    const created = await prisma.socialPost.create({
      data: {
        ...base(post.provider),
        text: post.text,
        media: [
          {
            pathname,
            fileUrl: `https://evals.invalid/${pathname}`,
            name,
            size: bytes.byteLength,
            mimeType: "image/svg+xml",
            kind: "image",
          },
        ],
        status: "SCHEDULED",
        scheduledAt: new Date(now.getTime() + post.inDays * DAY_MS),
      },
      select: { id: true },
    });
    seeded.push({ post, postId: created.id, pathname });
  }
  const target = seeded.find((entry) => entry.post.target)!;
  return {
    postId: target.postId,
    text: target.post.text,
    pathname: target.pathname,
    others: seeded
      .filter((entry) => entry !== target)
      .map((entry) => ({ postId: entry.postId, pathnames: [entry.pathname] })),
  };
}

const FIXTURE_AGENT_UNIT = "sokosumi-evals-credit";

/**
 * A listed Agent at the fixture's fixed price, so find_agents has a priced
 * match; a run's parallel repeats make or refresh the same one in turn. It is
 * visible to everyone on the database, so only a local run may make it.
 */
export async function seedAgent(
  agent: NonNullable<JourneyFixtures["agent"]>,
): Promise<void> {
  if (!evalEnvironment().startsWith("local"))
    throw new Error("The agent prepare runs on a local database only");
  const blockchainIdentifier = `sokosumi-evals-${agent.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const amount = {
    unit: FIXTURE_AGENT_UNIT,
    amount: convertCreditsToCents(agent.credits),
  };
  const listing = {
    name: agent.name,
    description: agent.description,
    summary: agent.description,
    apiBaseUrl: "https://agent.evals.invalid",
    isShown: true,
    status: "ONLINE" as const,
  };
  await createNetworkScope("mainnet").netTransaction(async (tx) => {
    // One writer at a time: the repeats seed at once, and the unit is shared.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${FIXTURE_AGENT_UNIT}))`;
    await tx.creditCost.upsert({
      where: { unit: FIXTURE_AGENT_UNIT },
      create: { unit: FIXTURE_AGENT_UNIT, centsPerUnit: 1n },
      update: {},
    });
    const existing = await tx.agent.findUnique({
      where: { blockchainIdentifier },
      select: {
        pricingId: true,
        pricing: { select: { agentFixedPricingId: true } },
      },
    });
    if (!existing) {
      await tx.agent.create({
        data: {
          ...listing,
          blockchainIdentifier,
          lastUptimeCheck: new Date(),
          uptimeCount: 1,
          uptimeCheckCount: 1,
          pricing: {
            create: {
              pricingType: "FIXED",
              fixedPricing: { create: { amounts: { create: amount } } },
            },
          },
        },
      });
      return;
    }
    await tx.agent.update({ where: { blockchainIdentifier }, data: listing });
    const fixedId = existing.pricing.agentFixedPricingId;
    if (fixedId) {
      await tx.unitValue.deleteMany({
        where: { agentFixedPricingId: fixedId },
      });
      await tx.unitValue.create({
        data: { ...amount, agentFixedPricingId: fixedId },
      });
    }
    await tx.agentPricing.update({
      where: { id: existing.pricingId },
      data: {
        pricingType: "FIXED",
        ...(fixedId
          ? {}
          : { fixedPricing: { create: { amounts: { create: amount } } } }),
      },
    });
  }, "Could not seed the fixture Agent");
}

/** The journey's world, made fresh before its first step. */
export async function prepareJourneyWorld(
  lane: EvalLaneRecord,
  prepare: readonly JourneyPrepare[],
  fixtures: JourneyFixtures = {},
  /** The bot the journey talks to: a shared room seats it. */
  botId: string = lane.sokoBotId,
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
  if (prepare.includes("launch-one-pager-pdf")) {
    world.seededFileId = await seedPdf(lane, LAUNCH_ONE_PAGER);
    world.seededFileMarker = "Nightly dreaming";
  }
  if (prepare.includes("customer-story-pdf")) {
    world.seededFileId = await seedPdf(lane, CUSTOMER_STORY);
    world.seededFileMarker = "43% fewer no-shows";
  }
  if (prepare.includes("outdated-price-post"))
    world.seededPostId = await seedOutdatedPricePost(lane);
  if (prepare.includes("investor-notes")) {
    world.seededFileId = await seedFile(lane, {
      name: "Seed investor notes.md",
      bytes: new TextEncoder().encode(investorNotes()),
      contentType: "text/markdown",
    });
    world.seededFileMarker = INVESTOR_FIXTURE.fits[0]?.startup;
  }
  if (prepare.includes("weekly-reports")) await seedCmoReports(lane);
  if (prepare.includes("friday-and-linkedin-posts"))
    world.seededWeekdayPostIds = await seedFridayAndLinkedInPosts(lane);
  if (prepare.includes("tasks"))
    await seedTasks(lane, world.coworkers.Mira, needs(fixtures.tasks, "tasks"));
  if (prepare.includes("teammate-room"))
    world.teammateRoomId = await seedTeammateRoom(lane, botId);
  if (prepare.includes("scheduled-posts")) {
    await seedScheduledPosts(
      lane,
      needs(fixtures.scheduledPosts, "scheduled-posts"),
    );
    world.seededPublished = (
      await prisma.socialPost.findMany({
        where: { projectId: lane.cusoProjectId, status: "PUBLISHED" },
        select: { id: true, text: true, media: true },
      })
    ).map((post) => ({
      id: post.id,
      text: post.text,
      pathnames: mediaPathnames(post.media),
    }));
  }
  if (prepare.includes("picture-posts"))
    world.seededPicture = await seedPicturePosts(
      lane,
      needs(fixtures.picturePosts, "picture-posts"),
    );
  if (prepare.includes("agent"))
    await seedAgent(needs(fixtures.agent, "agent"));
  world.upcomingByNetwork = await upcomingByNetwork(
    lane.cusoProjectId,
    await databaseNow(),
  );
  await clearWorkspaceSchedules(lane);
  if (prepare.includes("workspace-schedules"))
    world.seededSchedules = await seedWorkspaceSchedules(lane, a2a.junoId);
  return world;
}
