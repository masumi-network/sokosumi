import type { CmoHire } from "@sokosumi/database";
import {
  CMO_PRODUCTION_TURN_PREFIX,
  type CmoCalendarEntry,
  type CmoStrategy,
} from "@sokosumi/soko-bot";
import { CMO_CHANNELS } from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";

import prisma from "@/lib/db/prisma";
import {
  isCmoSubscribed,
  listCmoChannels,
  parseCmoStrategy,
} from "@/services/cmo.service";

/**
 * After the owner approves the strategy and pays, Cuso makes the whole month
 * at once: every piece written, its image or video made, and scheduled where
 * a network is connected. One background run does it; Core decides which
 * pieces are ready and starts another run for what is still missing, so a
 * run that ran out of time or failed never leaves the month half made. Once
 * the month is made, the same check makes what the daily watch adds (a news
 * piece, a holiday) and schedules drafts on a network connected later.
 */

const cmoProductionSchema = z.object({
  /** The strategy month this production makes (YYYY-MM). */
  month: z.string(),
  startedAt: z.string(),
  runs: z
    .array(
      z.object({
        id: z.string(),
        at: z.string(),
        /** Pieces ready when the run started, to see whether it moved any. */
        ready: z.number().int().optional(),
      }),
    )
    .default([]),
  /** When every piece was first made. */
  finishedAt: z.string().optional(),
});
export type CmoProduction = z.infer<typeof cmoProductionSchema>;

export function parseCmoProduction(value: unknown): CmoProduction | null {
  const parsed = cmoProductionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Runs a day before Core stops retrying; the next day it tries again. */
export const CMO_PRODUCTION_RUNS_PER_DAY = 4;
const DAY_MS = 24 * 60 * 60 * 1_000;
/** Pieces one run is given; a longer month continues in the next run. */
const PIECES_PER_RUN = 40;

const RUN_ACTIVE = new Set(["STARTING", "RUNNING", "CANCEL_REQUESTED"]);

type Format = { image: boolean; video?: boolean };
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

/**
 * A finished piece: its words are written, its picture is made when the
 * format has one, and on a connected network it is a scheduled post.
 */
export function cmoPieceReady(
  entry: CmoCalendarEntry,
  connected: ReadonlySet<string>,
): boolean {
  if (entry.status === "published" || entry.status === "skipped") return true;
  if (!entry.draft?.trim()) return false;
  if (cmoPieceNeedsMedia(entry) && !entry.imageFileId) return false;
  const social = channelOf(entry.channel)?.group === "social";
  if (social && connected.has(entry.channel) && !entry.socialPostId)
    return false;
  return true;
}

/**
 * Ids of the finished pieces. A picture counts for the first piece that uses
 * it: a production run once reused one image across two posts to finish
 * sooner.
 */
export function cmoReadyPieceIds(
  pieces: CmoCalendarEntry[],
  connected: ReadonlySet<string>,
): Set<string> {
  const used = new Set<string>();
  const ready = new Set<string>();
  for (const entry of pieces) {
    if (!cmoPieceReady(entry, connected)) continue;
    const file = cmoPieceNeedsMedia(entry) ? entry.imageFileId : undefined;
    if (file && used.has(file)) continue;
    if (file) used.add(file);
    ready.add(entry.id);
  }
  return ready;
}

/** The month's pieces still to come: what production makes and counts. */
export function cmoProductionPieces(
  strategy: Pick<CmoStrategy, "calendar">,
  now: Date,
): CmoCalendarEntry[] {
  const today = now.toISOString().slice(0, 10);
  return strategy.calendar.filter(
    (entry) =>
      entry.date >= today &&
      entry.status !== "published" &&
      entry.status !== "skipped",
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

function status(
  state: CmoProductionStatus["state"],
  pieces: CmoCalendarEntry[],
  ready: ReadonlySet<string>,
  production: CmoProduction | null,
): CmoProductionStatus {
  return {
    state,
    ready: ready.size,
    total: pieces.length,
    finishedAt: production?.finishedAt ?? null,
  };
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

function pieceLine(entry: CmoCalendarEntry): string {
  return [
    `- ${entry.id}`,
    `${entry.date}${entry.time ? ` ${entry.time}` : ""}`,
    `${entry.channel}/${entry.format}`,
    entry.approach ?? "no approach",
    entry.pillar ?? "",
    entry.campaignId ? `campaign ${entry.campaignId}` : "",
    `"${entry.title}"`,
    entry.brief ? `brief: ${entry.brief}` : "",
    entry.draft ? "(draft written; finish what is missing)" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What the production run reads: the whole month to make, in one brief. */
export function cmoProductionMessage(input: {
  businessName: string;
  strategy: CmoStrategy;
  pending: CmoCalendarEntry[];
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
    `Connected networks: ${connected.length > 0 ? connected.join(", ") : "none yet"}. Schedule each piece on a connected network at its date and time; on any other channel keep it a finished draft in the calendar.`,
    `The mix, as planned: ${cmoMixLedger(strategy)}. Each piece keeps its approach.`,
    "",
    `Pieces (${batch.length}${pending.length > batch.length ? ` of ${pending.length}; the rest come in the next run` : ""}):`,
    ...batch.map(pieceLine),
    "",
    "Work in two passes, as your production skill says: first write and save every draft (save_strategy part pieces every five or so pieces, sending only those entries), then make the pictures and schedule. A failed picture never stops the words.",
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

async function startProductionRun(
  hire: CmoHire,
  message: string,
  attempt: number,
  month: string,
): Promise<string> {
  const bot = await prisma.sokoBot.findUniqueOrThrow({
    where: { id: hire.sokoBotId },
    select: {
      id: true,
      userId: true,
      workspaceId: true,
      workspace: { select: { organizationId: true } },
    },
  });
  const parent = await parentTurnId(hire.sokoBotId);
  if (!parent) throw new Error("Cuso has no turn to start production from");
  const { findOrOpenOwnerDirectRoom } = await import(
    "@/services/soko-bot-chat.service"
  );
  const room = await findOrOpenOwnerDirectRoom(bot, hire.userId);
  const { sokoBotControlPlane } = await import(
    "@/services/soko-bot-control-plane.service"
  );
  const started = await sokoBotControlPlane.startTurn({
    userId: hire.userId,
    workspaceId: hire.workspaceId,
    sokoBotId: hire.sokoBotId,
    // One id per approval and attempt: two callers racing start the same
    // run, and a plan approved again starts its own.
    clientTurnId: `${CMO_PRODUCTION_TURN_PREFIX}${hire.id}:${month}:${hire.strategyApprovedAt?.getTime() ?? 0}:${attempt}`,
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
      destinationRoomId: room.id,
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

/**
 * Moves the month's production on: starts it once the strategy is approved
 * and paid for, records when every piece is ready, and starts another run
 * for what an ended run left missing. Safe to call any time and from
 * anywhere; it is a no-op while a run works.
 */
interface ProductionRead {
  status: CmoProductionStatus;
  strategy: CmoStrategy | null;
  production: CmoProduction | null;
  pending: CmoCalendarEntry[];
}

/** Where the month's production stands; reads only, never starts a run. */
export async function readCmoProduction(
  hire: CmoHire,
  context: { connected: ReadonlySet<string>; subscribed: boolean; now: Date },
): Promise<ProductionRead> {
  const { connected, now } = context;
  const strategy = parseCmoStrategy(hire.strategy);
  if (!strategy)
    return {
      status: { state: "waiting", ready: 0, total: 0, finishedAt: null },
      strategy,
      production: null,
      pending: [],
    };
  const pieces = cmoProductionPieces(strategy, now);
  const ready = cmoReadyPieceIds(pieces, connected);
  const pending = pieces.filter((entry) => !ready.has(entry.id));
  const stored = parseCmoProduction(hire.production);
  const production = stored?.month === strategy.month ? stored : null;
  const read = (state: CmoProductionStatus["state"]) => ({
    status: status(state, pieces, ready, production),
    strategy,
    production,
    pending,
  });
  if (!hire.strategyApprovedAt || !context.subscribed) return read("waiting");
  if (pending.length === 0) return read("ready");
  const last = await lastRunStatus(production);
  if (last && RUN_ACTIVE.has(last)) return read("running");
  if (
    runsToday(production, now) >= CMO_PRODUCTION_RUNS_PER_DAY ||
    (last === "COMPLETED" &&
      stalledToday(production, pieces.length - pending.length, now))
  )
    return read("stuck");
  return read("running");
}

async function lastRunStatus(
  production: CmoProduction | null,
): Promise<string | null> {
  const last = production?.runs.at(-1);
  if (!last) return null;
  const run = await prisma.sokoBotTurn.findUnique({
    where: { id: last.id },
    select: { status: true },
  });
  return run?.status ?? null;
}

/**
 * The last run finished without making a single piece ready (images
 * refused, a tool down): another run today would only fail the same way. A
 * run that crashed (a model or network error) is simply tried again.
 */
function stalledToday(
  production: CmoProduction | null,
  ready: number,
  now: Date,
): boolean {
  const last = production?.runs.at(-1);
  return Boolean(
    last &&
      last.ready !== undefined &&
      ready <= last.ready &&
      now.getTime() - Date.parse(last.at) < DAY_MS,
  );
}

async function runActive(production: CmoProduction | null): Promise<boolean> {
  const status = await lastRunStatus(production);
  return status !== null && RUN_ACTIVE.has(status);
}

function runsToday(production: CmoProduction | null, now: Date): number {
  return (production?.runs ?? []).filter(
    (run) => now.getTime() - Date.parse(run.at) < DAY_MS,
  ).length;
}

export async function advanceCmoProduction(
  hire: CmoHire,
  now: Date = new Date(),
): Promise<CmoProductionStatus> {
  const connected = await connectedChannels(hire.projectId);
  const {
    status: current,
    strategy,
    production: stored,
    pending,
  } = await readCmoProduction(hire, {
    connected,
    subscribed: await isCmoSubscribed(hire),
    now,
  });
  if (!strategy || current.state === "waiting" || current.state === "stuck")
    return current;
  const production: CmoProduction = stored ?? {
    month: strategy.month,
    startedAt: now.toISOString(),
    runs: [],
  };
  if (current.state === "ready") {
    if (production.finishedAt && stored) return current;
    const finishedAt = production.finishedAt ?? now.toISOString();
    await prisma.cmoHire.update({
      where: { id: hire.id },
      data: { production: { ...production, finishedAt } },
    });
    return { ...current, finishedAt };
  }
  if (await runActive(production)) return current;
  const attempt = production.runs.length + 1;
  const runId = await startProductionRun(
    hire,
    cmoProductionMessage({
      businessName: hire.businessName,
      strategy,
      pending,
      connected,
      attempt,
      topUp: Boolean(production.finishedAt),
    }),
    attempt,
    production.month,
  );
  const next = {
    ...production,
    runs: production.runs.some((run) => run.id === runId)
      ? production.runs
      : [
          ...production.runs,
          { id: runId, at: now.toISOString(), ready: current.ready },
        ],
  };
  await prisma.cmoHire.update({
    where: { id: hire.id },
    data: { production: next },
  });
  return current;
}

/** Starts production in the background; the caller's request does not wait. */
export function kickCmoProduction(hireId: string): void {
  waitUntil(
    prisma.cmoHire
      .findUnique({ where: { id: hireId } })
      .then((hire) => (hire ? advanceCmoProduction(hire) : null))
      .catch((error: unknown) => {
        console.warn("CMO production could not start", {
          hireId,
          error: error instanceof Error ? error.message : "unknown",
        });
      }),
  );
}

/** The cron: every approved hire, so new and missing pieces get made. */
export async function syncCmoProduction(
  shouldContinue: () => boolean = () => true,
): Promise<{ checked: number }> {
  const hires = await prisma.cmoHire.findMany({
    where: { strategyApprovedAt: { not: null } },
    orderBy: { updatedAt: "asc" },
  });
  let checked = 0;
  for (const hire of hires) {
    if (!shouldContinue()) break;
    try {
      await advanceCmoProduction(hire);
      checked += 1;
    } catch (error) {
      console.warn("CMO production sync skipped a hire", {
        hireId: hire.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return { checked };
}
