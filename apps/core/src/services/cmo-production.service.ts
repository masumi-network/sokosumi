import {
  CMO_PRODUCTION_TURN_PREFIX,
  type CmoCalendarEntry,
  type CmoStrategy,
  SOKO_BOT_CMO_SCHEDULES,
} from "@sokosumi/soko-bot";
import { CMO_CHANNELS } from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";

import prisma from "@/lib/db/prisma";
import { isCmoSubscribed } from "@/services/cmo-billing.service";
import {
  type Cuso,
  cmoRunnerUserId,
  findCusoForBot,
  listCmoChannels,
  listCusosWithApprovedStrategy,
} from "@/services/cmo-cuso.service";
import {
  approvedMarketingStrategy,
  listMarketingStrategyPosts,
  type MarketingStrategyPost,
  parseMarketingPlan,
  withSocialPostCalendar,
} from "@/services/marketing-strategy.service";

/**
 * After the owner approves the strategy and pays, Cuso makes the whole month
 * at once: the approved version's Social posts each get their words and
 * their image or video, and are scheduled where a network is connected. One
 * background run does it; Core decides which pieces are ready and starts
 * another run for what is still missing, so a run that ran out of time or
 * failed never leaves the month half made. Once the month is made, the same
 * check makes what the daily watch adds (a news piece, a holiday) and
 * schedules drafts on a network connected later. Nothing is stored: the
 * month is read from the posts, and the runs are Cuso's background turns.
 */

/** Runs a day before Core stops retrying; the next day it tries again. */
export const CMO_PRODUCTION_RUNS_PER_DAY = 4;
const DAY_MS = 24 * 60 * 60 * 1_000;
/** Pieces one run is given; a longer month continues in the next run. */
const PIECES_PER_RUN = 40;

const RUN_ACTIVE = new Set(["STARTING", "RUNNING", "CANCEL_REQUESTED"]);

type Format = {
  image: boolean;
  video?: boolean;
  slides?: readonly [number, number];
};
type Channel = { group: string; formats: Record<string, Format> };

function channelOf(key: string): Channel | undefined {
  return (CMO_CHANNELS as Record<string, Channel>)[key];
}

/** Whether the piece's format comes with an image or video Cuso makes. */
export function cmoPieceNeedsMedia(
  entry: Pick<CmoCalendarEntry, "channel" | "format">,
): boolean {
  const format = channelOf(entry.channel)?.formats[entry.format];
  return Boolean(format?.image || format?.video);
}

/** The fewest slides a carousel format needs; 0 for a single-image format. */
export function cmoPieceMinSlides(
  entry: Pick<CmoCalendarEntry, "channel" | "format">,
): number {
  return channelOf(entry.channel)?.formats[entry.format]?.slides?.[0] ?? 0;
}

/** A Social post of the approved version: its entry and its media files. */
export type CmoPiece = CmoCalendarEntry & { media: readonly string[] };

/** Every picture a piece shows: its cover and, for a carousel, each slide. */
function pieceFiles(piece: CmoPiece): string[] {
  return cmoPieceNeedsMedia(piece) ? [...new Set(piece.media)] : [];
}

/**
 * A finished piece: its words are written, its pictures are made when the
 * format has them, and on a connected network it is scheduled; on any other
 * network it waits for the connection as a finished draft.
 */
export function cmoPieceReady(
  piece: CmoPiece,
  connected: ReadonlySet<string>,
): boolean {
  if (piece.status === "published" || piece.status === "skipped") return true;
  if (!piece.draft?.trim()) return false;
  if (
    cmoPieceNeedsMedia(piece) &&
    new Set(piece.media).size < Math.max(1, cmoPieceMinSlides(piece))
  )
    return false;
  return !connected.has(piece.channel) || piece.status === "scheduled";
}

/**
 * Ids of the finished pieces. A picture counts for the first piece that uses
 * it: a production run once reused one image across two posts to finish
 * sooner.
 */
export function cmoReadyPieceIds(
  pieces: CmoPiece[],
  connected: ReadonlySet<string>,
): Set<string> {
  const used = new Set<string>();
  const ready = new Set<string>();
  for (const piece of pieces) {
    if (!cmoPieceReady(piece, connected)) continue;
    const files = pieceFiles(piece);
    if (files.some((file) => used.has(file))) continue;
    for (const file of files) used.add(file);
    ready.add(piece.id);
  }
  return ready;
}

/** The month's Social posts still to come: what production makes and counts. */
export function cmoProductionPieces(
  posts: MarketingStrategyPost[],
  now: Date,
): CmoPiece[] {
  const today = now.toISOString().slice(0, 10);
  return posts
    .map((post) => ({
      ...post.entry,
      media: post.media.map((file) => file.pathname),
    }))
    .filter(
      (piece) =>
        piece.date >= today &&
        piece.status !== "published" &&
        piece.status !== "skipped",
    );
}

export interface CmoProductionStatus {
  /**
   * waiting: not approved and paid yet; running: Cuso is making pieces;
   * ready: every piece is made; stuck: today's runs ended with pieces missing.
   */
  state: "waiting" | "running" | "ready" | "stuck";
  ready: number;
  total: number;
  finishedAt: string | null;
}

async function connectedChannels(projectId: string): Promise<Set<string>> {
  const channels = await listCmoChannels(projectId);
  return new Set(
    channels
      .filter((channel) => channel.status === "ACTIVE")
      .map((channel) => channel.provider.toLowerCase()),
  );
}

/** The mix as the calendar holds it, so the brief shows what each piece serves. */
export function cmoMixLedger(
  strategy: Pick<CmoStrategy, "mix" | "calendar">,
): string {
  const pieces = strategy.calendar.filter(
    (entry) => entry.status !== "skipped",
  );
  return strategy.mix
    .map((part) => {
      const count = pieces.filter(
        (entry) => entry.approach === part.approach,
      ).length;
      return `${part.approach} ${count} of ${pieces.length} (plan ${part.share}%)`;
    })
    .join(", ");
}

function pieceLine(piece: CmoPiece): string {
  return [
    `- ${piece.id}`,
    `${piece.date}${piece.time ? ` ${piece.time}` : ""}`,
    `${piece.channel}/${piece.format}`,
    piece.approach ?? "no approach",
    piece.pillar ?? "",
    piece.campaignId ? `campaign ${piece.campaignId}` : "",
    `"${piece.title}"`,
    piece.brief ? `brief: ${piece.brief}` : "",
    cmoPieceMinSlides(piece) > 0 ? carouselNote(piece) : "",
    piece.draft ? "(words written; finish what is missing)" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A carousel's line in the brief. One product photo is enough for its slides:
 * a run once asked the owner for more photos and made none.
 */
function carouselNote(piece: CmoPiece): string {
  const made = new Set(piece.media).size;
  const count = `carousel: at least ${cmoPieceMinSlides(piece)} slides, ${made} made`;
  return made > 0
    ? `${count}; make the rest yourself with generate_image, the cover's file as referenceFileIds, each a different view of the same product (detail, on an anonymous model, flat lay). These are your pictures of the real product, not invented ones; do not wait for more photos`
    : count;
}

/** What the production run reads: the whole month to make, in one brief. */
export function cmoProductionMessage(input: {
  businessName: string;
  strategy: CmoStrategy;
  pending: CmoPiece[];
  connected: ReadonlySet<string>;
  attempt: number;
  /** The month was made before: these pieces are new or changed since. */
  topUp: boolean;
}): string {
  const { strategy, pending } = input;
  const batch = pending.slice(0, PIECES_PER_RUN);
  const connected = [...input.connected];
  return [
    `Background run: make ${input.businessName}'s month`,
    input.topUp
      ? "The month is made. The pieces below are new or still missing something: a piece the daily watch added for news or a holiday, one the owner changed, or a finished draft for a network connected since. Make them now, following your production skill, so they fit the month around them."
      : "The owner approved the strategy and paid. Make every piece below now, in this run, following your production skill, so the whole month is one consistent plan rather than pieces written day by day.",
    !input.topUp && input.attempt > 1
      ? "An earlier run made part of the month; these pieces are still missing something."
      : "",
    "Each piece is already a draft Social post, under the id below: never create another post for it. Put its words and its pictures on that post with update_social_post (read get_social_post first for its revision).",
    `Connected networks: ${connected.length > 0 ? connected.join(", ") : "none yet"}. On a connected network, schedule each post with schedule_social_post at its date and time; on any other network it stays a finished draft until the owner connects it.`,
    `The mix, as planned: ${cmoMixLedger(strategy)}. Each piece keeps its approach.`,
    "",
    `Pieces (${batch.length}${pending.length > batch.length ? ` of ${pending.length}; the rest come in the next run` : ""}):`,
    ...batch.map(pieceLine),
    "",
    "Work in two passes, as your production skill says: first write every post's words, then make the pictures and schedule. A failed picture never stops the words.",
    "When every piece is made, report with report_update kind production: how many pieces you made per channel, what is scheduled and what waits for a connection. Then end with DONE: and one sentence for the owner. A reply without DONE: is treated as a progress note and you will be asked to continue.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** The turn a run hangs under: the newest top-level turn of Cuso's bot. */
async function parentTurnId(sokoBotId: string): Promise<string | null> {
  const turn = await prisma.sokoBotTurn.findFirst({
    where: { sokoBotId, parentTurnId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return turn?.id ?? null;
}

/**
 * One run id per approval, attempt and the pieces ready when it started:
 * two callers racing start the same run, a plan approved again starts its
 * own, and a finished run shows whether it moved any piece.
 */
function approvalRunPrefix(sokoBotId: string, approvedAt: Date): string {
  return `${CMO_PRODUCTION_TURN_PREFIX}${sokoBotId}:${approvedAt.getTime()}:`;
}

async function startProductionRun(
  hire: Cuso,
  message: string,
  clientTurnId: string,
): Promise<string> {
  const bot = await prisma.sokoBot.findUniqueOrThrow({
    where: { id: hire.sokoBotId },
    select: { sharedRoomId: true },
  });
  const parent = await parentTurnId(hire.sokoBotId);
  if (!parent) throw new Error("Cuso has no turn to start production from");
  // The run reports in Cuso's shared room and spends as his runner: who hired
  // him, or an owner or admin once they left (ADR 0061).
  const runnerId = await cmoRunnerUserId(hire);
  if (!runnerId || !bot.sharedRoomId)
    throw new Error("Cuso has no member or shared room to run production for");
  const { sokoBotControlPlane } = await import(
    "@/services/soko-bot-control-plane.service"
  );
  const started = await sokoBotControlPlane.startTurn({
    userId: runnerId,
    workspaceId: hire.workspaceId,
    sokoBotId: hire.sokoBotId,
    clientTurnId,
    message,
    source: "EVENT",
    presetRoute: {
      route: "MANAGE_WORK",
      writeScope: "WORK",
      reason: "CMO production: make and schedule the month's pieces.",
      // No open web: the Brand Brain and the plan are everything it needs,
      // and a clean run may make images and schedule posts.
      sandbox: false,
    },
    background: {
      parentTurnId: parent,
      title: `Make ${hire.businessName}'s month`,
      destinationRoomId: bot.sharedRoomId,
    },
  });
  if (
    started.reconciliationLeaseToken &&
    (started.status === "STARTING" || started.status === "RUNNING")
  )
    waitUntil(
      sokoBotControlPlane
        .reconcileTurn(
          started.turnId,
          undefined,
          started.reconciliationLeaseToken,
        )
        .catch((error: unknown) => {
          console.warn("CMO production run reconciliation stopped", {
            turnId: started.turnId,
            error: error instanceof Error ? error.message : "unknown",
          });
        }),
    );
  return started.turnId;
}

type ProductionRun = {
  clientTurnId: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
};

/** Cuso's production runs of today and of this approval, newest first. */
function productionRuns(
  sokoBotId: string,
  approvedAt: Date,
  now: Date,
): Promise<ProductionRun[]> {
  return prisma.sokoBotTurn.findMany({
    where: {
      sokoBotId,
      clientTurnId: { startsWith: CMO_PRODUCTION_TURN_PREFIX },
      OR: [
        { createdAt: { gt: new Date(now.getTime() - DAY_MS) } },
        {
          clientTurnId: {
            startsWith: approvalRunPrefix(sokoBotId, approvedAt),
          },
        },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      clientTurnId: true,
      status: true,
      createdAt: true,
      completedAt: true,
    },
  });
}

/** Pieces ready when a run started: its run id's last part. */
function readyAtStart(run: ProductionRun): number | null {
  const ready = Number(run.clientTurnId.split(":").at(-1));
  return Number.isInteger(ready) ? ready : null;
}

interface ProductionRead {
  status: CmoProductionStatus;
  strategy: CmoStrategy | null;
  /** When the version being made was approved: one run id per approval. */
  approvedAt: Date | null;
  pending: CmoPiece[];
  /** This approval's runs, newest first. */
  runs: ProductionRun[];
}

/** Where the month's production stands; reads only, never starts a run. */
export async function readCmoProduction(
  hire: Cuso,
  context: { connected: ReadonlySet<string>; subscribed: boolean; now: Date },
): Promise<ProductionRead> {
  const { connected, now } = context;
  // Only the approved version is made; a draft is never produced.
  const approved = await approvedMarketingStrategy(hire.projectId);
  const plan = parseMarketingPlan(approved?.plan);
  const approvedAt = approved?.approvedAt ?? null;
  if (!approved || !plan || !approvedAt)
    return {
      status: { state: "waiting", ready: 0, total: 0, finishedAt: null },
      strategy: plan,
      approvedAt,
      pending: [],
      runs: [],
    };
  const posts = await listMarketingStrategyPosts(approved);
  const strategy = withSocialPostCalendar(plan, posts);
  const pieces = cmoProductionPieces(posts, now);
  const ready = cmoReadyPieceIds(pieces, connected);
  const pending = pieces.filter((piece) => !ready.has(piece.id));
  const read = (
    state: CmoProductionStatus["state"],
    runs: ProductionRun[] = [],
  ): ProductionRead => ({
    status: {
      state,
      ready: ready.size,
      total: pieces.length,
      finishedAt:
        state === "ready"
          ? (runs
              .find((run) => run.status === "COMPLETED")
              ?.completedAt?.toISOString() ?? null)
          : null,
    },
    strategy,
    approvedAt,
    pending,
    runs,
  });
  if (!context.subscribed) return read("waiting");
  const all = await productionRuns(hire.sokoBotId, approvedAt, now);
  const prefix = approvalRunPrefix(hire.sokoBotId, approvedAt);
  const runs = all.filter((run) => run.clientTurnId.startsWith(prefix));
  if (pending.length === 0) return read("ready", runs);
  if (all[0] && RUN_ACTIVE.has(all[0].status)) return read("running", runs);
  const today = all.filter(
    (run) => now.getTime() - run.createdAt.getTime() < DAY_MS,
  );
  // The last run finished without making a single piece ready (images
  // refused, a tool down): another run today would only fail the same way.
  // A run that crashed (a model or network error) is simply tried again.
  const last = runs[0];
  const lastReady = last ? readyAtStart(last) : null;
  const stalled =
    last?.status === "COMPLETED" &&
    now.getTime() - last.createdAt.getTime() < DAY_MS &&
    lastReady !== null &&
    ready.size <= lastReady;
  if (today.length >= CMO_PRODUCTION_RUNS_PER_DAY || stalled)
    return read("stuck", runs);
  return read("running", runs);
}

/**
 * Moves the month's production on: starts it once the strategy is approved
 * and paid for, and starts another run for what an ended run left missing.
 * Safe to call any time and from anywhere; it is a no-op while a run works.
 */
export async function advanceCmoProduction(
  hire: Cuso,
  now: Date = new Date(),
): Promise<CmoProductionStatus> {
  const connected = await connectedChannels(hire.projectId);
  const {
    status: current,
    strategy,
    approvedAt,
    pending,
    runs,
  } = await readCmoProduction(hire, {
    connected,
    subscribed: await isCmoSubscribed(hire),
    now,
  });
  if (!strategy || !approvedAt || current.state !== "running") return current;
  if (runs[0] && RUN_ACTIVE.has(runs[0].status)) return current;
  const attempt = runs.length + 1;
  await startProductionRun(
    hire,
    cmoProductionMessage({
      businessName: hire.businessName,
      strategy,
      pending,
      connected,
      attempt,
      topUp: runs.some((run) => run.status === "COMPLETED"),
    }),
    `${approvalRunPrefix(hire.sokoBotId, approvedAt)}${attempt}:${current.ready}`,
  );
  return current;
}

/** Starts production in the background; the caller's request does not wait. */
export function kickCmoProduction(sokoBotId: string): void {
  waitUntil(
    findCusoForBot(sokoBotId)
      .then((hire) => (hire ? advanceCmoProduction(hire) : null))
      .catch((error: unknown) => {
        console.warn("CMO production could not start", {
          sokoBotId,
          error: error instanceof Error ? error.message : "unknown",
        });
      }),
  );
}

/**
 * Points Cuso's own rhythms at his runner, so they keep acting as a current
 * member once the person who hired him left the business (ADR 0061).
 */
async function keepCmoRhythmsWithRunner(hire: Cuso): Promise<void> {
  const runnerId = await cmoRunnerUserId(hire);
  if (!runnerId) return;
  await prisma.sokoBotSchedule.updateMany({
    where: {
      sokoBotId: hire.sokoBotId,
      systemKey: { in: SOKO_BOT_CMO_SCHEDULES.map((schedule) => schedule.key) },
      OR: [
        { requestedByUserId: null },
        { requestedByUserId: { not: runnerId } },
      ],
    },
    data: { requestedByUserId: runnerId },
  });
}

/** The cron: every Cuso with an approved plan, so new and missing pieces get made. */
export async function syncCmoProduction(
  shouldContinue: () => boolean = () => true,
): Promise<{ checked: number }> {
  const hires = await listCusosWithApprovedStrategy();
  let checked = 0;
  for (const hire of hires) {
    if (!shouldContinue()) break;
    try {
      await keepCmoRhythmsWithRunner(hire);
      await advanceCmoProduction(hire);
      checked += 1;
    } catch (error) {
      console.warn("CMO production sync skipped a Cuso", {
        sokoBotId: hire.sokoBotId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return { checked };
}
