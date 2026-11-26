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
import { ensureA2aWorld } from "../eval-a2a";
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
  return world;
}
