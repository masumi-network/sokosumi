import type { SokoBotTurnStatus } from "@sokosumi/database";
import {
  type BrandBrain,
  CMO_PRODUCTION_TURN_PREFIX,
  type CmoCalendarEntry,
  cmoWritesMonthAtOnce,
  getSokoBotVersion,
  type MarketingStrategyPlan,
  SOKO_BOT_CMO_RHYTHMS,
  writingSkillsBrief,
} from "@sokosumi/soko-bot";
import {
  type CmoVolumeLevel,
  cmoMonthAtLevel,
  isCmoOwnerConfirmedChannel,
} from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import {
  emitCoreWarning,
  recordCoreWarning,
  runAsBackgroundWork,
} from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { getSeoAnalysisExecution } from "@/lib/seo/analysis-executor-config";
import { evaluateWithJev } from "@/lib/soko-bot/jev";
import { reportSokoBotReconciliationLeaseLoss } from "@/lib/soko-bot/reconciliation-lease";
import { getBrandBrain, parseBrandBrain } from "@/services/brand-brain.service";
import { cmoPlanLevel, isCmoSubscribed } from "@/services/cmo-billing.service";
import { scheduleMissingCmoBrandIndex } from "@/services/cmo-brand-media.service";
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
  cmoPieceIsTalking,
  cmoPieceNeedsMedia,
  cmoPieceSlides,
  cmoPieceTakesStyle,
  listCmoMediaJobs,
} from "@/services/cmo-media-maker.service";
import {
  advanceCmoMonthReview,
  type CmoPillarShare,
  cmoBrandFacts,
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
import { referenceLibraryAvailable } from "@/services/reference-library.service";

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

/**
 * Runs a day that made nothing ready before Core stops retrying; the next
 * day it tries again. A run that made pieces does not count: NMKR's test
 * copy, 2026-11-21, used four runs in 11 minutes, each making pieces, and
 * then waited a day with 104 of 171 missing.
 */
export const CMO_PRODUCTION_RUNS_PER_DAY = 4;
const DAY_MS = 24 * 60 * 60 * 1_000;
/** Pieces one run is given; a longer month continues in the next run. */
const PIECES_PER_RUN = 40;
/** How long a month may wait for its next run before the owner is told. */
export const CMO_PRODUCTION_START_GRACE_MS = 30 * 60 * 1_000;

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
 * Whether another piece already counts for one of these files. A talking
 * video is the exception: its posts on several networks show the one video.
 */
function usedElsewhere(
  piece: CmoPiece,
  files: readonly string[],
  used: Set<string>,
): boolean {
  if (cmoPieceIsTalking(piece)) return false;
  if (files.some((file) => used.has(file))) return true;
  for (const file of files) used.add(file);
  return false;
}

/**
 * A finished piece: its words are written, its pictures are made when the
 * format has them, and on a connected network it is scheduled; on any other
 * network it waits for the connection as a finished draft. On a network the
 * owner confirms post by post (TikTok) it is finished once made: it waits for
 * the owner, not for Cuso.
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
  return (
    !connected.has(piece.channel) ||
    piece.status === "scheduled" ||
    isCmoOwnerConfirmedChannel(piece.channel)
  );
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
      !usedElsewhere(piece, files, used)
    ) {
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
    if (usedElsewhere(piece, pieceFiles(piece), used)) continue;
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
   * every piece is made; stuck: today's runs ended with pieces missing;
   * blocked: starting, but no run could start for half an hour.
   */
  state: "waiting" | "starting" | "running" | "ready" | "stuck" | "blocked";
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
  /** How much of the month the plan bought makes. */
  level: CmoVolumeLevel;
  /** Entries of the month the plan bought does not make; a bigger plan does. */
  beyondPlan: string[];
}

export async function cmoConnectedChannels(
  projectId: string,
): Promise<Set<string>> {
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
      return `${part.approach} ${count} of ${pieces.length} (planned ${part.share}%)`;
    })
    .join(", ");
}

/** One piece as a production brief lists it: what to make and what is missing. */
export function cmoPieceLine(piece: CmoPiece, failed: boolean): string {
  const slides = cmoPieceSlides(piece);
  return [
    `- ${piece.id}`,
    `${piece.date}${piece.time ? ` ${piece.time}` : ""}`,
    `${piece.channel}/${piece.format}`,
    piece.approach ?? "no approach",
    piece.pillar ?? "",
    piece.campaignId ? `campaign ${piece.campaignId}` : "",
    `"${piece.title}"`,
    // The first plan writes weeks two to four as titles only.
    piece.brief
      ? `brief: ${piece.brief}`
      : "(no brief: write it from its title, approach and pillar)",
    piece.story ? `story: ${piece.story}` : "",
    piece.claim ? `claim: ${piece.claim}` : "",
    slides > 0
      ? `carousel of ${slides} slides: one visual and a line per slide in slides, Core makes each slide`
      : "",
    piece.videoOf
      ? `(the talking video of ${piece.videoOf} on ${piece.channel}: write only this post's own caption for ${piece.channel}; its script stays on ${piece.videoOf})`
      : cmoPieceIsTalking(piece)
        ? piece.script
          ? failed
            ? "(its video failed twice: write a different script)"
            : ""
          : "(write its script)"
        : cmoPieceNeedsMedia(piece) && !piece.visual
          ? "(write its visual)"
          : failed
            ? piece.styleReferenceId
              ? "(its picture failed every try: write a different visual and pick another style reference)"
              : "(its picture failed twice: write a different visual)"
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

/** What the writer may write: a Social post missing its words, visual or script. */
export function cmoWriterPieces(pending: readonly CmoPiece[]): CmoPiece[] {
  return pending.filter(
    (piece) =>
      !isMarketingFilePiece(piece) &&
      (!piece.draft?.trim() ||
        (cmoPieceIsTalking(piece) && !piece.videoOf && !piece.script) ||
        (cmoPieceNeedsMedia(piece) &&
          !cmoPieceIsTalking(piece) &&
          !piece.visual)),
  );
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

/** Each proof point's verdict, by its words: a Brand Brain changes rarely. */
const praiseVerdicts = new Map<string, boolean>();
/** Below this Jev reads a point as not clearly positive. */
const PRAISE_PASS = 0.5;

/**
 * The proof points a cmo-v8 piece may stand on: clearly positive praise and
 * plain facts. NMKR's month opened two posts on "One G2 review, rated
 * 4.0/5" whose reviewer found the fees "somewhat high": the reputation
 * section holds complaints for Cuso's understanding, never a post's angle.
 * When Jev does not answer, a point that names a review or rating is left
 * out and the rest kept.
 */
export async function cmoPraiseOnly(
  points: readonly string[],
  evaluate: typeof evaluateWithJev = evaluateWithJev,
): Promise<{ points: string[]; costUsd: number }> {
  const unread = points.filter((point) => !praiseVerdicts.has(point));
  let costUsd = 0;
  if (unread.length > 0) {
    try {
      const answer = await evaluate({
        state: { points: unread.map((point, index) => ({ index, point })) },
        questions: Object.fromEntries(
          unread.map((_, index) => [
            `p${index}`,
            {
              type: "boolean" as const,
              instructions: `Is point ${index} clearly positive about the business (praise, a result, a customer's win) or a plain fact? A complaint, a criticism, a mixed or lukewarm review, or a middling rating with a reservation is not.`,
            },
          ]),
        ),
        timeoutMs: 30_000,
      });
      costUsd = answer.costUsd;
      unread.forEach((point, index) => {
        const read = answer.answers.get(`p${index}`);
        if (read?.type === "boolean")
          praiseVerdicts.set(point, read.probability >= PRAISE_PASS);
      });
    } catch {
      // Unread points stay out only when they name a review or rating.
    }
  }
  return {
    points: points.filter(
      (point) =>
        praiseVerdicts.get(point) ??
        !/\b(review|reviewer|rating|rated|stars?)\b/i.test(point),
    ),
    costUsd,
  };
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
  /** The reference library is set up here: every picture takes an old print's look. */
  styles?: boolean;
  /** Core writes the social pieces (write_month_pieces); Cuso gets the rest. */
  coreWrites?: boolean;
}): string {
  const { strategy } = input;
  const forCore = input.coreWrites ? cmoWriterPieces(input.pending) : [];
  const pending = input.pending.filter((piece) => !forCore.includes(piece));
  const batch = pending.slice(0, PIECES_PER_RUN);
  const connected = [...input.connected];
  return [
    `Background run: make ${input.businessName}'s month`,
    input.topUp
      ? "The month is made. The pieces below are new or still missing something: a piece the daily watch added for news or a holiday, one the owner changed, or a finished draft for a network connected since. Make them now, following your production skill, so they fit the month around them."
      : "The owner approved the strategy and paid. Make every piece below now, in this run, following your production skill, so the month reads as one rather than as pieces written day by day.",
    !input.topUp && input.attempt > 1
      ? "An earlier run made part of the month; these pieces are still missing something."
      : "",
    forCore.length > 0
      ? `Core writes ${forCore.length} social piece${forCore.length === 1 ? "" : "s"} of the month for you: call write_month_pieces first, and again until left is 0. Then fix each piece it hands back${batch.length > 0 ? ", and make the pieces below yourself" : ""}.`
      : "",
    batch.some((piece) => !isMarketingFilePiece(piece))
      ? "Each social piece is already a draft Social post, under the id below: never create another post for it. Put its words on that post with update_social_post (read get_social_post first for its revision)."
      : "",
    batch.some(isMarketingFilePiece)
      ? "Every other piece (an article, a page fix, ad copy, a newsletter issue) becomes a file in the owner's Files: write it in full, ready to paste, launch or send, and save it with save_strategy part pieces, sending that entry with its id and draft (and its visual when its format has a picture). Core writes the file; never upload it yourself."
      : "",
    input.coreWrites
      ? `Connected networks: ${connected.length > 0 ? connected.join(", ") : "none yet"}. Core schedules every finished post on a connected network at its date and time, with or without a picture: never schedule one yourself. On any other network a post stays a finished draft until the owner connects it.`
      : `Connected networks: ${connected.length > 0 ? connected.join(", ") : "none yet"}. On a connected network, schedule a post that needs no picture with schedule_social_post at its date and time; Core schedules a post with a picture once it has it. On any other network a post stays a finished draft until the owner connects it.`,
    `The mix, as planned: ${cmoMixLedger(strategy)}. Each piece keeps its approach.`,
    input.proof && input.proof.length > 0
      ? [
          "Proof you may name, from the Brand Brain (customers, results, reviews; use each in at most two pieces):",
          ...input.proof.map((point) => `- ${point}`),
        ].join("\n")
      : "",
    "",
    batch.length > 0
      ? `${forCore.length > 0 ? "Pieces for you" : "Pieces"} (${batch.length}${pending.length > batch.length ? ` of ${pending.length}; the rest come in the next run` : ""}):`
      : "",
    ...batch.map((piece) =>
      cmoPieceLine(piece, input.failedMedia?.has(piece.id) ?? false),
    ),
    "",
    batch.length > 0
      ? "As your production skill says: first list each pillar's different messages and give every piece its own, then write every piece's words, then save the visuals of the pieces with a picture or video (visual and visualFileIds from brandPictures) in one save_strategy part pieces call. Core makes and attaches every picture and video; never call generate_image or generate_video."
      : "Core makes and attaches every picture and video; never call generate_image or generate_video.",
    input.styles && batch.some(cmoPieceTakesStyle)
      ? [
          "Picture styles: every piece with a picture takes the look of an old print, whatever it shows; this replaces your skill's choice per piece. Before you save the visuals, call find_style_references for each such piece with what it is about and the look that suits it, and save each with its styleReferenceId in that same call; Core refuses a save that leaves one without a style.",
          "- A different reference for every piece, never one twice in the month; vary kinds and eras.",
          "- A single picture carries headline: at most six words from its hook.",
          "- A carousel takes one reference for all its slides, and slideHeadlines: one entry per slide, in order, at most six words each, lettered on that slide.",
          "- When the picture must show the brand's real page, screen or product, name that one picture in visualFileIds: Core sets it inside the style, unchanged and readable. For every other styled piece send visualFileIds as an empty list, or the screenshot lands in a picture that is not about it.",
          "- Never ask a picture to show a price, number, plan or label the brand's picture does not show: the model invents one, and Core turns the picture down.",
        ].join("\n")
      : "",
    "",
    // A piece Core hands back names its network: read_writing_skill opens it.
    writingSkillsBrief(batch.map((piece) => piece.channel)),
    "When every piece is made, report with report_update kind production: how many pieces you made per channel, what is scheduled and what waits for a connection. Then end with DONE: and one sentence for the owner. A reply without DONE: is treated as a progress note and you will be asked to continue.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** Whether Cuso's version has Core write the month (cmo-v6 on). */
async function cmoCoreWritesMonth(sokoBotId: string): Promise<boolean> {
  const bot = await prisma.sokoBot.findUnique({
    where: { id: sokoBotId },
    select: { versionId: true },
  });
  return cmoWritesMonthAtOnce(getSokoBotVersion(bot?.versionId).skills);
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
  const { reconciliationLeaseToken } = started;
  if (
    reconciliationLeaseToken &&
    (started.status === "STARTING" || started.status === "RUNNING")
  )
    waitUntil(
      runAsBackgroundWork(() =>
        sokoBotControlPlane
          .reconcileTurn(started.turnId, undefined, reconciliationLeaseToken)
          .catch((error: unknown) => {
            if (reportSokoBotReconciliationLeaseLoss(started.turnId, error))
              return;
            // A turn's error can quote its prompt, so only its name and code.
            emitCoreWarning(
              {
                operation: "cmo_production_run",
                sokoBotTurn: { id: started.turnId },
                failure: messageSafeErrorFields(error),
              },
              {
                message: "Stopped following a CMO production run",
                why: "Reconciling the production turn threw",
                fix: "The turn's own reconciliation picks it up again. If it repeats, look up the error name and code under failure.",
              },
            );
          }),
      ),
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

/** Whether more pieces were ready when the run ended than when it started. */
function madeProgress(run: ProductionRun, readyAfter: number | null): boolean {
  const before = readyAtStart(run);
  return before !== null && readyAfter !== null && readyAfter > before;
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
        level: "all_in",
        beyondPlan: [],
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
  // The month is written at the top volume; the plan bought decides how much
  // of it is made, and a bigger plan makes more of the same month.
  const level = await cmoPlanLevel(cuso.projectId, now);
  const inPlan = cmoMonthAtLevel(strategy.calendar, strategy.channels, level);
  const beyondPlan = strategy.calendar
    .filter(
      (entry) =>
        !inPlan.made.has(entry.id) &&
        entry.status !== "skipped" &&
        entry.status !== "published",
    )
    .map((entry) => entry.id);
  const pieces = cmoProductionPieces(posts, now, strategy.calendar).filter(
    (piece) => inPlan.made.has(piece.id),
  );
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
      level,
      beyondPlan,
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
  // Runs' createdAt is PostgreSQL time, so their day is measured on it.
  const runsNow = await databaseNow();
  const all = await productionRuns(cuso.sokoBotId, approvedAt, runsNow);
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
  // Only this approval's runs count: a version approved the same day as an
  // earlier one once found the cap used up and waited until morning.
  const today = runs.filter(
    (run, index) =>
      runsNow.getTime() - run.createdAt.getTime() < DAY_MS &&
      !madeProgress(
        run,
        index === 0 ? ready.size : readyAtStart(runs[index - 1]!),
      ),
  );
  // The last run finished without making a single piece ready (images
  // refused, a tool down): another run today would only fail the same way.
  // A run that crashed (a model or network error) is simply tried again.
  const last = runs[0];
  const lastReady = last ? readyAtStart(last) : null;
  const stalled =
    last?.status === "COMPLETED" &&
    runsNow.getTime() - last.createdAt.getTime() < DAY_MS &&
    lastReady !== null &&
    ready.size <= lastReady;
  if (today.length >= CMO_PRODUCTION_RUNS_PER_DAY || stalled)
    return read("stuck", runs);
  // Every sync tries to start a run; one that has not started in half an
  // hour keeps failing, and the owner should not read "about to start".
  const since = last?.completedAt ?? last?.createdAt ?? approvedAt;
  if (runsNow.getTime() - since.getTime() > CMO_PRODUCTION_START_GRACE_MS)
    return read("blocked", runs);
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
  const connected = await cmoConnectedChannels(cuso.projectId);
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
      {
        cuso,
        versionId: version.id,
        connected,
        schedulesEveryPost: await cmoCoreWritesMonth(cuso.sokoBotId),
      },
      pieces,
    ).catch((error: unknown) => {
      // Media errors can quote a prompt or a post, so only name and code.
      recordCoreWarning(
        { operation: "cmo_media", sokoBot: { id: cuso.sokoBotId } },
        {
          message: "CMO pictures did not move on this round",
          why: "Advancing the month's pictures threw",
          fix: "The next production sync tries again. If it repeats, look up the error name and code under failure.",
        },
        { failure: messageSafeErrorFields(error) },
      );
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
      facts: brain ? cmoBrandFacts(brain, strategy.offer) : null,
      runs,
      runIdPrefix: approvalRunPrefix(cuso.sokoBotId, approvedAt),
      ready: current.ready,
      now,
      startRewrite: (message, clientTurnId) =>
        startProductionRun(
          cuso,
          message,
          clientTurnId,
          `Rewrite pieces that miss the strategy for ${cuso.businessName}`,
        ),
    });
    return current;
  }
  if (current.state !== "starting" && current.state !== "blocked")
    return current;
  const attempt = runs.length + 1;
  const runId = `${approvalRunPrefix(cuso.sokoBotId, approvedAt)}${attempt}:`;
  // A run's end and the sync both move production on. NMKR's test copy,
  // 2026-11-21: both read "starting" and each started attempt 3.
  const message = cmoProductionMessage({
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
    styles: referenceLibraryAvailable(),
    coreWrites: await cmoCoreWritesMonth(cuso.sokoBotId),
  });
  const started = await onlyOnce(cuso.sokoBotId, runId, () =>
    startProductionRun(cuso, message, `${runId}${current.ready}`),
  );
  return started ? { ...current, state: "running" } : current;
}

/**
 * Starts the run unless this attempt already has one, holding a lock per
 * Cuso so two callers cannot both start it.
 */
async function onlyOnce(
  sokoBotId: string,
  attemptPrefix: string,
  start: () => Promise<string>,
): Promise<boolean> {
  return prisma.$transaction(
    async (tx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${`cmo-production:${sokoBotId}`}::TEXT, 0)) AS locked
      `;
      if (!lock?.locked) return false;
      const existing = await tx.sokoBotTurn.count({
        where: { sokoBotId, clientTurnId: { startsWith: attemptPrefix } },
      });
      if (existing > 0) return false;
      await start();
      return true;
    },
    { timeout: 60_000 },
  );
}

/** Starts production in the background; the caller's request does not wait. */
export function kickCmoProduction(sokoBotId: string): void {
  waitUntil(
    runAsBackgroundWork(() =>
      findCusoForBot(sokoBotId)
        .then((cuso) => (cuso ? advanceCmoProduction(cuso) : null))
        .catch((error: unknown) => {
          // Production errors can quote the plan or a prompt: name and code.
          emitCoreWarning(
            {
              operation: "cmo_production",
              sokoBot: { id: sokoBotId },
              failure: messageSafeErrorFields(error),
            },
            {
              message: "CMO production did not start",
              why: "Advancing production threw",
              fix: "The next CMO production sync, every 10 minutes, tries again. If it repeats, look up the error name and code under failure.",
            },
          );
        }),
    ),
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

/** The weekly SEO audit rides on this sync; its failure never holds back the month. */
async function keepCmoSeo(cuso: Cuso, now: Date): Promise<void> {
  if (!getSeoAnalysisExecution().enabled) return;
  try {
    const { keepCmoSeoAudit, verifyCmoSeoChanges } = await import(
      "@/services/cmo-seo-audit.service"
    );
    await keepCmoSeoAudit(cuso, now);
    await verifyCmoSeoChanges(cuso);
    const { startCmoSeoReport } = await import(
      "@/services/cmo-seo-report.service"
    );
    await startCmoSeoReport(cuso, now);
  } catch (error) {
    recordCoreWarning(
      { operation: "cmo_seo_sync", sokoBot: { id: cuso.sokoBotId } },
      {
        message: "CMO SEO sync skipped a Cuso",
        why: "Keeping the weekly SEO audit, checking done page changes or starting the weekly SEO report threw",
        fix: "The next sync tries again. If it repeats, look up the error name and code under failure.",
      },
      { failure: messageSafeErrorFields(error) },
    );
  }
}

/** A Cuso that was let go is not in the sync below; his weekly SEO audit is paused here. */
async function pauseSeoAuditsOfEndedCusos(): Promise<void> {
  if (!getSeoAnalysisExecution().enabled) return;
  try {
    const { pauseCmoSeoAuditsWithoutCuso } = await import(
      "@/services/cmo-seo-audit.service"
    );
    await pauseCmoSeoAuditsWithoutCuso();
  } catch (error) {
    recordCoreWarning(
      { operation: "cmo_seo_sync" },
      {
        message: "CMO SEO sync could not pause the audits of ended Cusos",
        why: "Pausing a weekly SEO audit whose Cuso was archived or deleted threw",
        fix: "The next sync tries again. Until then the audit can still run and charge 750 credits; pause its Task Schedule by hand if this repeats.",
      },
      { failure: messageSafeErrorFields(error) },
    );
  }
}

/** A new Cuso's first competitor check rides on this sync too. */
async function keepCmoCompetitors(cuso: Cuso, now: Date): Promise<void> {
  try {
    const { keepCusoFirstCompetitorCheck } = await import(
      "@/services/cmo-competitors.service"
    );
    await keepCusoFirstCompetitorCheck(cuso, now);
  } catch (error) {
    // The error can quote a page or an article.
    recordCoreWarning(
      { operation: "cmo_competitor_sync", sokoBot: { id: cuso.sokoBotId } },
      {
        message: "CMO production sync skipped a Cuso's first competitor check",
        why: "Running the first competitor check or starting its watch run threw",
        fix: "The next sync tries again, and the weekly competitor sync checks him within the hour; a check is charged once. If it repeats, look up the error name and code under failure.",
      },
      { failure: messageSafeErrorFields(error) },
    );
  }
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
  await pauseSeoAuditsOfEndedCusos();
  const hires = cmoSyncOrder(await listCusosWithApprovedStrategy(), now);
  // In the background from the start, so it has the whole run.
  await scheduleMissingCmoBrandIndex(hires).catch(() => undefined);
  let checked = 0;
  for (const cuso of hires) {
    if (!shouldContinue()) break;
    try {
      await keepCmoRhythmsWithRunner(cuso);
      await advanceCmoProduction(cuso);
      await keepCmoSeo(cuso, now);
      await keepCmoCompetitors(cuso, now);
      checked += 1;
    } catch (error) {
      // One event per Cuso skipped; the error can quote the plan or a prompt.
      recordCoreWarning(
        { operation: "cmo_production_sync", sokoBot: { id: cuso.sokoBotId } },
        {
          message: "CMO production sync skipped a Cuso",
          why: "Advancing this Cuso's production threw",
          fix: "The next sync tries again. If it repeats, look up the error name and code under failure.",
        },
        { failure: messageSafeErrorFields(error) },
      );
    }
  }
  return { checked };
}
