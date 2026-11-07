import type { SokoBotTurnStatus } from "@sokosumi/database";
import {
  type BrandBrain,
  CMO_PRODUCTION_TURN_PREFIX,
  type CmoCalendarEntry,
  type MarketingStrategyPlan,
  SOKO_BOT_CMO_RHYTHMS,
  writingSkillsBrief,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";

import prisma from "@/lib/db/prisma";
import { getBrandBrain, parseBrandBrain } from "@/services/brand-brain.service";
import { isCmoSubscribed } from "@/services/cmo-billing.service";
import {
  type Cuso,
  cmoRunnerUserId,
  findCusoForBot,
  listCmoChannels,
  listCusosWithApprovedStrategy,
} from "@/services/cmo-cuso.service";
import {
  advanceCmoMedia,
  type CmoMediaJob,
  cmoMediaState,
  cmoPieceNeedsMedia,
  cmoPieceSlides,
  listCmoMediaJobs,
} from "@/services/cmo-media-maker.service";
import {
  advanceCmoMonthReview,
  type CmoPillarShare,
  cmoPillarShares,
  parseCmoMonthReview,
} from "@/services/cmo-month-review.service";
import {
  approvedMarketingStrategy,
  entryMedia,
  isMarketingFilePiece,
  listMarketingStrategyFiles,
  listMarketingStrategyPosts,
  type MarketingStrategyPost,
  parseMarketingPlan,
  withMarketingFiles,
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

const RUN_ACTIVE = new Set<SokoBotTurnStatus>([
  "STARTING",
  "RUNNING",
  "CANCEL_REQUESTED",
]);

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
  // A piece that is not a Social post keeps its words in its Project file.
  if (!piece.draft?.trim() && !piece.fileId) return false;
  if (
    cmoPieceNeedsMedia(piece) &&
    new Set(piece.media).size < Math.max(1, cmoPieceSlides(piece))
  )
    return false;
  return !connected.has(piece.channel) || piece.status === "scheduled";
}

/** How far each pass of a run got: words first, then pictures. */
export function cmoProductionSteps(
  pieces: CmoPiece[],
): Pick<CmoProductionStatus, "written" | "pictured" | "needPictures"> {
  const done = (piece: CmoPiece) =>
    piece.status === "published" || piece.status === "skipped";
  const withPictures = pieces.filter(cmoPieceNeedsMedia);
  // A picture counts for the first piece that uses it, as in cmoReadyPieceIds.
  const used = new Set<string>();
  let pictured = 0;
  for (const piece of withPictures) {
    const files = pieceFiles(piece);
    if (done(piece)) {
      pictured += 1;
    } else if (
      files.length >= Math.max(1, cmoPieceSlides(piece)) &&
      !files.some((file) => used.has(file))
    ) {
      for (const file of files) used.add(file);
      pictured += 1;
    }
  }
  return {
    written: pieces.filter(
      (piece) => done(piece) || piece.draft?.trim() || piece.fileId,
    ).length,
    pictured,
    needPictures: withPictures.length,
  };
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

/**
 * The month's pieces still to come: what production makes and counts. Social
 * pieces are the version's Social posts; every other piece is a calendar
 * entry whose words become a Project file.
 */
export function cmoProductionPieces(
  posts: MarketingStrategyPost[],
  now: Date,
  calendar: CmoCalendarEntry[] = [],
): CmoPiece[] {
  const today = now.toISOString().slice(0, 10);
  const filePieces = calendar.filter(isMarketingFilePiece).map((entry) => ({
    ...entry,
    media: entryMedia(entry),
  }));
  return [
    ...posts.map((post) => ({
      ...post.entry,
      media: post.media.map((file) => file.pathname),
    })),
    ...filePieces,
  ].filter(
    (piece) =>
      piece.date >= today &&
      piece.status !== "published" &&
      piece.status !== "skipped",
  );
}

export interface CmoProductionStatus {
  /**
   * waiting: not approved and paid yet; starting: approved, no run working
   * yet (the next sync starts one); running: a run is making pieces; ready:
   * every piece is made; stuck: today's runs ended with pieces missing.
   */
  state: "waiting" | "starting" | "running" | "ready" | "stuck";
  ready: number;
  total: number;
  /** Pieces whose words are written: the first pass of a run. */
  written: number;
  /** Pieces with every picture their format needs, of those that need one. */
  pictured: number;
  needPictures: number;
  finishedAt: string | null;
  /**
   * Once the made month was read: each pillar's planned share beside the
   * share its pieces really have, and whether Cuso is rewriting pieces.
   */
  pillars: { shares: CmoPillarShare[]; rewriting: boolean } | null;
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
  strategy: Pick<MarketingStrategyPlan, "mix" | "calendar">,
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

function pieceLine(piece: CmoPiece, failed: boolean): string {
  const slides = cmoPieceSlides(piece);
  return [
    `- ${piece.id}`,
    `${piece.date}${piece.time ? ` ${piece.time}` : ""}`,
    `${piece.channel}/${piece.format}`,
    piece.approach ?? "no approach",
    piece.pillar ?? "",
    piece.campaignId ? `campaign ${piece.campaignId}` : "",
    `"${piece.title}"`,
    piece.brief ? `brief: ${piece.brief}` : "",
    piece.story ? `story: ${piece.story}` : "",
    slides > 0
      ? `carousel of ${slides} slides: one visual and a line per slide in slides, Core makes each slide`
      : "",
    cmoPieceNeedsMedia(piece) && !piece.visual
      ? "(write its visual)"
      : failed
        ? "(its picture failed twice: write a different visual)"
        : "",
    isMarketingFilePiece(piece)
      ? piece.fileId
        ? "(file written; finish what is missing)"
        : "(Project file: save its words with save_strategy part pieces)"
      : piece.draft
        ? "(words written; finish what is missing)"
        : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Proof points a brief may hold: enough for a month, short enough for a brief. */
const MAX_PROOF_POINTS = 12;
/** Brand Brain sections whose findings name customers, results and reviews. */
const PROOF_SECTIONS = ["proof", "customers", "reputation"] as const;

/**
 * The Brand Brain's named customers, results and reviews, word for word.
 * Cuso's context keeps each section's summary only, so a month planned 11
 * customer-proof pieces and named no customer.
 */
export function cmoProofPoints(brain: BrandBrain | null): string[] {
  const points = PROOF_SECTIONS.flatMap(
    (key) =>
      brain?.profile?.[key]?.findings
        .filter((finding) => finding.evidence !== "inference")
        .map((finding) => finding.point) ?? [],
  );
  return [...new Set(points)].slice(0, MAX_PROOF_POINTS);
}

/** What the production run reads: the whole month to make, in one brief. */
export function cmoProductionMessage(input: {
  businessName: string;
  strategy: MarketingStrategyPlan;
  pending: CmoPiece[];
  connected: ReadonlySet<string>;
  attempt: number;
  /** The month was made before: these pieces are new or changed since. */
  topUp: boolean;
  /** Named customers, results and reviews from the Brand Brain, word for word. */
  proof?: readonly string[];
  /** Pieces whose picture failed twice for its visual. */
  failedMedia?: ReadonlySet<string>;
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
    batch.some((piece) => !isMarketingFilePiece(piece))
      ? "Each social piece is already a draft Social post, under the id below: never create another post for it. Put its words on that post with update_social_post (read get_social_post first for its revision)."
      : "",
    batch.some(isMarketingFilePiece)
      ? "Every other piece (an article, a page fix, ad copy, a newsletter issue) becomes a file in the owner's Files: write it in full, ready to paste, launch or send, and save it with save_strategy part pieces, sending that entry with its id and draft (and its visual when its format has a picture). Core writes the file; never upload it yourself."
      : "",
    `Connected networks: ${connected.length > 0 ? connected.join(", ") : "none yet"}. On a connected network, schedule a post that needs no picture with schedule_social_post at its date and time; Core schedules a post with a picture once it has it. On any other network a post stays a finished draft until the owner connects it.`,
    `The mix, as planned: ${cmoMixLedger(strategy)}. Each piece keeps its approach.`,
    input.proof && input.proof.length > 0
      ? [
          "Proof you may name, from the Brand Brain (customers, results, reviews; use each in at most two pieces):",
          ...input.proof.map((point) => `- ${point}`),
        ].join("\n")
      : "",
    "",
    `Pieces (${batch.length}${pending.length > batch.length ? ` of ${pending.length}; the rest come in the next run` : ""}):`,
    ...batch.map((piece) =>
      pieceLine(piece, input.failedMedia?.has(piece.id) ?? false),
    ),
    "",
    "As your production skill says: first list each pillar's different messages and give every piece its own, then write every piece's words, then save the visuals of the pieces with a picture or video (visual and visualFileIds from brandPictures) in one save_strategy part pieces call. Core makes and attaches every picture and video; never call generate_image or generate_video.",
    "",
    writingSkillsBrief(batch.map((piece) => piece.channel)),
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

/**
 * When the owner first approved a plan, so hiring ended. A later approval
 * clears the earlier one, but each approval's first production run keeps
 * its approval time in its id, and turns stay as long as the bot.
 */
export async function cmoHiredAt(
  sokoBotId: string,
  approvedAt: Date | null,
): Promise<Date | null> {
  const prefix = `${CMO_PRODUCTION_TURN_PREFIX}${sokoBotId}:`;
  const first = await prisma.sokoBotTurn.findFirst({
    where: { sokoBotId, clientTurnId: { startsWith: prefix } },
    orderBy: { createdAt: "asc" },
    select: { clientTurnId: true },
  });
  const firstApproval = Number(
    first?.clientTurnId?.slice(prefix.length).split(":")[0],
  );
  const times = [
    Number.isFinite(firstApproval) ? firstApproval : null,
    approvedAt?.getTime() ?? null,
  ].filter((time): time is number => time !== null);
  return times.length > 0 ? new Date(Math.min(...times)) : null;
}

async function startProductionRun(
  cuso: Cuso,
  message: string,
  clientTurnId: string,
  title = `Make ${cuso.businessName}'s month`,
): Promise<string> {
  const bot = await prisma.sokoBot.findUniqueOrThrow({
    where: { id: cuso.sokoBotId },
    select: { sharedRoomId: true },
  });
  const parent = await parentTurnId(cuso.sokoBotId);
  if (!parent) throw new Error("Cuso has no turn to start production from");
  // The run reports in Cuso's shared room and spends as his runner: who hired
  // him, or an owner or admin once they left (ADR 0061).
  const runnerId = await cmoRunnerUserId(cuso);
  if (!runnerId || !bot.sharedRoomId)
    throw new Error("Cuso has no member or shared room to run production for");
  const { sokoBotControlPlane } = await import(
    "@/services/soko-bot-control-plane.service"
  );
  const started = await sokoBotControlPlane.startTurn({
    userId: runnerId,
    workspaceId: cuso.workspaceId,
    sokoBotId: cuso.sokoBotId,
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
      title,
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
  status: SokoBotTurnStatus;
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
  /** The approved version being made. */
  version: { id: string; monthReview: unknown } | null;
  strategy: MarketingStrategyPlan | null;
  /** When the version being made was approved: one run id per approval. */
  approvedAt: Date | null;
  /** Every piece still to come, for Core's media maker. */
  pieces: CmoPiece[];
  /** What a run still has to do: pieces missing words or a usable visual. */
  pending: CmoPiece[];
  /** Pieces whose picture failed twice for their visual. */
  failedMedia: Set<string>;
  /** This approval's runs, newest first. */
  runs: ProductionRun[];
  /** A run or its follow-up is still working, possibly from an earlier approval. */
  working: boolean;
}

/** Where the month's production stands; reads only, never starts a run. */
export async function readCmoProduction(
  cuso: Cuso,
  context: { connected: ReadonlySet<string>; subscribed: boolean; now: Date },
): Promise<ProductionRead> {
  const { connected, now } = context;
  // Only the approved version is made; a draft is never produced.
  const approved = await approvedMarketingStrategy(cuso.projectId);
  const plan = parseMarketingPlan(approved?.plan);
  const approvedAt = approved?.approvedAt ?? null;
  if (!approved || !plan || !approvedAt)
    return {
      status: {
        state: "waiting",
        ready: 0,
        total: 0,
        written: 0,
        pictured: 0,
        needPictures: 0,
        finishedAt: null,
        pillars: null,
      },
      version: null,
      strategy: plan,
      approvedAt,
      pieces: [],
      pending: [],
      failedMedia: new Set(),
      runs: [],
      working: false,
    };
  const [posts, files] = await Promise.all([
    listMarketingStrategyPosts(approved),
    listMarketingStrategyFiles(approved),
  ]);
  const strategy = withMarketingFiles(
    withSocialPostCalendar(plan, posts),
    files,
  );
  const pieces = cmoProductionPieces(posts, now, strategy.calendar);
  const ready = cmoReadyPieceIds(pieces, connected);
  const unready = pieces.filter((piece) => !ready.has(piece.id));
  const jobs: CmoMediaJob[] = await listCmoMediaJobs(
    cuso.projectId,
    approved.id,
  );
  const media = new Map(
    pieces.map((piece) => [piece.id, cmoMediaState(piece, jobs)]),
  );
  const failedMedia = new Set(
    pieces.flatMap((piece) =>
      media.get(piece.id) === "failed" ? [piece.id] : [],
    ),
  );
  // A written piece whose picture Core is making waits for Core, not a run.
  const pending = unready.filter(
    (piece) =>
      !(
        (piece.draft?.trim() || piece.fileId) &&
        media.get(piece.id) === "making"
      ),
  );
  const check = parseCmoMonthReview(approved.monthReview);
  const pillarsOf = (runs: ProductionRun[]) =>
    check
      ? {
          shares: cmoPillarShares(strategy.pillars, check),
          rewriting:
            check.round === 1 &&
            runs.some(
              (run) =>
                run.clientTurnId === check.rewriteRunId &&
                RUN_ACTIVE.has(run.status),
            ),
        }
      : null;
  const read = (
    state: CmoProductionStatus["state"],
    runs: ProductionRun[] = [],
    working = false,
  ): ProductionRead => ({
    status: {
      state,
      ready: ready.size,
      total: pieces.length,
      ...cmoProductionSteps(pieces),
      finishedAt:
        state === "ready"
          ? (runs
              .find((run) => run.status === "COMPLETED")
              ?.completedAt?.toISOString() ?? null)
          : null,
      pillars: pillarsOf(runs),
    },
    version: approved,
    strategy,
    approvedAt,
    pieces,
    pending,
    failedMedia,
    runs,
    working,
  });
  if (!context.subscribed) return read("waiting");
  const all = await productionRuns(cuso.sokoBotId, approvedAt, now);
  const prefix = approvalRunPrefix(cuso.sokoBotId, approvedAt);
  const runs = all.filter((run) => run.clientTurnId.startsWith(prefix));
  // A follow-up a run left behind (wait_for) works on the same pieces.
  const following = await prisma.sokoBotTurn.count({
    where: {
      sokoBotId: cuso.sokoBotId,
      clientTurnId: { startsWith: "watch:" },
      status: { in: [...RUN_ACTIVE] },
    },
  });
  const working =
    Boolean(all[0] && RUN_ACTIVE.has(all[0].status)) || following > 0;
  if (unready.length === 0) return read("ready", runs, working);
  if (working) return read("running", runs, true);
  // Every piece has its words and visual: Core is making the pictures.
  if (pending.length === 0) return read("running", runs);
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
  return read("starting", runs);
}

/**
 * Moves the month's production on: starts it once the strategy is approved
 * and paid for, and starts another run for what an ended run left missing.
 * Safe to call any time and from anywhere; it is a no-op while a run works.
 */
export async function advanceCmoProduction(
  cuso: Cuso,
  now: Date = new Date(),
): Promise<CmoProductionStatus> {
  const connected = await connectedChannels(cuso.projectId);
  const {
    status: current,
    version,
    strategy,
    approvedAt,
    pieces,
    pending,
    failedMedia,
    runs,
    working,
  } = await readCmoProduction(cuso, {
    connected,
    subscribed: await isCmoSubscribed(cuso),
    now,
  });
  // Core makes the pictures from the visuals saved so far, runs or no runs.
  if (version && current.state !== "waiting")
    await advanceCmoMedia(
      { cuso, versionId: version.id, connected },
      pieces,
    ).catch((error: unknown) => {
      console.warn("CMO media could not move on", {
        sokoBotId: cuso.sokoBotId,
        error: error instanceof Error ? error.message : "unknown",
      });
    });
  if (!strategy || !approvedAt || working) return current;
  // A made month is reviewed for its pillars, skills and voice, and the
  // pieces that miss are rewritten once.
  if (current.state === "ready" && version) {
    const brain = parseBrandBrain((await getBrandBrain(cuso.projectId))?.body);
    await advanceCmoMonthReview({
      sokoBotId: cuso.sokoBotId,
      businessName: cuso.businessName,
      version,
      strategy,
      voice: brain?.voice ?? null,
      runs,
      runIdPrefix: approvalRunPrefix(cuso.sokoBotId, approvedAt),
      ready: current.ready,
      now,
      startRewrite: (message, clientTurnId) =>
        startProductionRun(
          cuso,
          message,
          clientTurnId,
          `Rewrite pieces that miss the plan for ${cuso.businessName}`,
        ),
    });
    return current;
  }
  if (current.state !== "starting") return current;
  const attempt = runs.length + 1;
  await startProductionRun(
    cuso,
    cmoProductionMessage({
      businessName: cuso.businessName,
      strategy,
      pending,
      connected,
      attempt,
      topUp: runs.some((run) => run.status === "COMPLETED"),
      proof: cmoProofPoints(
        parseBrandBrain((await getBrandBrain(cuso.projectId))?.body),
      ),
      failedMedia,
    }),
    `${approvalRunPrefix(cuso.sokoBotId, approvedAt)}${attempt}:${current.ready}`,
  );
  return { ...current, state: "running" };
}

/** Starts production in the background; the caller's request does not wait. */
export function kickCmoProduction(sokoBotId: string): void {
  waitUntil(
    findCusoForBot(sokoBotId)
      .then((cuso) => (cuso ? advanceCmoProduction(cuso) : null))
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
async function keepCmoRhythmsWithRunner(cuso: Cuso): Promise<void> {
  const runnerId = await cmoRunnerUserId(cuso);
  if (!runnerId) return;
  await prisma.sokoBotSchedule.updateMany({
    where: {
      sokoBotId: cuso.sokoBotId,
      systemKey: { in: SOKO_BOT_CMO_RHYTHMS.map((schedule) => schedule.key) },
      OR: [
        { requestedByUserId: null },
        { requestedByUserId: { not: runnerId } },
      ],
    },
    data: { requestedByUserId: runnerId },
  });
}

const SYNC_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Each 10-minute cycle starts one Cuso further along, so a cycle that runs
 * out of time leaves out different Cusos each time, never the same newest ones.
 */
export function cmoSyncOrder<T>(hires: T[], now: Date): T[] {
  if (hires.length === 0) return hires;
  const start = Math.floor(now.getTime() / SYNC_INTERVAL_MS) % hires.length;
  return [...hires.slice(start), ...hires.slice(0, start)];
}

/** The cron: every Cuso with an approved plan, so new and missing pieces get made. */
export async function syncCmoProduction(
  shouldContinue: () => boolean = () => true,
  now: Date = new Date(),
): Promise<{ checked: number }> {
  const hires = cmoSyncOrder(await listCusosWithApprovedStrategy(), now);
  let checked = 0;
  for (const cuso of hires) {
    if (!shouldContinue()) break;
    try {
      await keepCmoRhythmsWithRunner(cuso);
      await advanceCmoProduction(cuso);
      checked += 1;
    } catch (error) {
      console.warn("CMO production sync skipped a Cuso", {
        sokoBotId: cuso.sokoBotId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return { checked };
}
