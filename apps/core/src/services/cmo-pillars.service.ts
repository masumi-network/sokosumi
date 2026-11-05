import { Prisma } from "@sokosumi/database";
import type {
  CmoCalendarEntry,
  CmoPillar,
  MarketingStrategyPlan,
} from "@sokosumi/soko-bot";
import { z } from "zod";

import prisma from "@/lib/db/prisma";
import { evaluateWithJev, type JevQuestion } from "@/lib/soko-bot/jev";
import {
  CMO_SHARE_TOLERANCE,
  samePillar,
} from "@/services/cmo-plan-review.service";
import { isMarketingFilePiece } from "@/services/marketing-strategy.service";
import { readMarketingPieceText } from "@/services/marketing-strategy-files.service";
import { recordSokoBotCheckUsage } from "@/services/soko-bot-billing.service";

/**
 * Once the month is made, Jev, a separate evaluation model, reads every
 * piece and says which pillar it is really about: a calendar can hold the
 * pillars while the words drift to one favourite topic. When the made
 * shares stray from the plan, Cuso gets one run to rewrite the pieces that
 * read as another pillar than their entry names; after it, Jev reads the
 * month again for the owner and nothing more is rewritten.
 */

/** What Jev read the month as; stored on the approved version. */
export const cmoPillarCheckSchema = z.object({
  /** 1 after the made month, 2 after the rewrite run. */
  round: z.number().int().min(1).max(2),
  checkedAt: z.string(),
  /** Entry id → the pillar its words are about, or null for none of them. */
  pieces: z.record(z.string(), z.string().nullable()),
  /** The rewrite run this check started, by its client turn id. */
  rewriteRunId: z.string().optional(),
});
export type CmoPillarCheck = z.infer<typeof cmoPillarCheckSchema>;

export function parseCmoPillarCheck(value: unknown): CmoPillarCheck | null {
  const parsed = cmoPillarCheckSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface CmoPillarShare {
  name: string;
  /** The plan's share, in percent. */
  planned: number;
  /** The share of the checked pieces Jev read as this pillar, in percent. */
  made: number;
  pieces: number;
}

/** Each pillar's planned share beside the share its pieces really have. */
export function cmoPillarShares(
  pillars: readonly CmoPillar[],
  check: CmoPillarCheck,
): CmoPillarShare[] {
  const read = Object.values(check.pieces);
  return pillars.map((pillar) => {
    const pieces = read.filter(
      (name) => name !== null && samePillar(name, pillar.name),
    ).length;
    return {
      name: pillar.name,
      planned: pillar.share,
      made: read.length ? Math.round((pieces / read.length) * 100) : 0,
      pieces,
    };
  });
}

/** Whether a pillar's made share strays from its plan by more than the mix may. */
export function cmoPillarsOff(shares: readonly CmoPillarShare[]): boolean {
  return shares.some(
    (share) => Math.abs(share.made - share.planned) > CMO_SHARE_TOLERANCE,
  );
}

/**
 * Pieces still to come whose words read as another pillar than their entry
 * names: what the rewrite run fixes. A published piece stays as it is, and
 * so does one whose entry names no pillar of the plan: an older plan's
 * entries sometimes did, and there is nothing to rewrite it towards.
 */
export function cmoPiecesOffPillar(
  pillars: readonly CmoPillar[],
  calendar: readonly CmoCalendarEntry[],
  check: CmoPillarCheck,
  now: Date,
): (CmoCalendarEntry & { pillar: string; readAs: string | null })[] {
  const today = now.toISOString().slice(0, 10);
  return calendar.flatMap((entry) => {
    const planned = pillars.find(
      (pillar) => entry.pillar && samePillar(entry.pillar, pillar.name),
    );
    if (!(entry.id in check.pieces) || !planned) return [];
    if (entry.status === "published" || entry.date < today) return [];
    const readAs = check.pieces[entry.id] ?? null;
    return readAs && samePillar(readAs, planned.name)
      ? []
      : [{ ...entry, pillar: planned.name, readAs }];
  });
}

/** Jev reads a piece's opening; enough to tell its topic. */
const READ_CHARS = 1_500;
const PIECES_PER_CHECK = 8;

/** The month's made pieces and their words: a post's text or a file's. */
async function madePieces(
  version: { id: string },
  calendar: readonly CmoCalendarEntry[],
): Promise<{ id: string; title: string; text: string }[]> {
  const made = calendar.filter(
    (entry) =>
      entry.status !== "skipped" &&
      (isMarketingFilePiece(entry)
        ? Boolean(entry.fileId)
        : Boolean(entry.draft)),
  );
  const pieces = await Promise.all(
    made.map(async (entry) => {
      const text = isMarketingFilePiece(entry)
        ? await readMarketingPieceText(version, entry.id).catch(() => null)
        : (entry.draft ?? null);
      return text?.trim()
        ? { id: entry.id, title: entry.title, text: text.slice(0, READ_CHARS) }
        : null;
    }),
  );
  return pieces.filter((piece) => piece !== null);
}

/**
 * Which pillar each piece is about, a few pieces per question set. A batch
 * Jev fails leaves its pieces out of the count, never in a wrong pillar.
 */
export async function readCmoPillars(
  pillars: readonly CmoPillar[],
  pieces: readonly { id: string; title: string; text: string }[],
): Promise<{ pieces: Record<string, string | null>; costUsd: number }> {
  const criteria = Object.fromEntries([
    ...pillars.map((pillar, index) => [
      `p${index}`,
      pillar.why ? `${pillar.name}: ${pillar.why}` : pillar.name,
    ]),
    ["none", "None of these topics"],
  ]);
  const batches: (typeof pieces)[number][][] = [];
  for (let index = 0; index < pieces.length; index += PIECES_PER_CHECK)
    batches.push(pieces.slice(index, index + PIECES_PER_CHECK));
  const results = await Promise.all(
    batches.map(async (batch) => {
      try {
        const { answers, costUsd } = await evaluateWithJev({
          state: {
            pillars: pillars.map((pillar) => pillar.name),
            pieces: batch.map((piece, index) => ({
              piece: index,
              title: piece.title,
              text: piece.text,
            })),
          },
          questions: Object.fromEntries(
            batch.map((_, index): [string, JevQuestion] => [
              `piece${index}`,
              {
                type: "choice",
                instructions: `Which pillar is piece ${index} mostly about, judged by its text rather than its title?`,
                criteria,
              },
            ]),
          ),
          timeoutMs: 30_000,
        });
        const read = batch.flatMap(
          (piece, index): [string, string | null][] => {
            const answer = answers.get(`piece${index}`);
            if (answer?.type !== "choice") return [];
            const pillar = pillars[Number(answer.choice.slice(1))];
            return [
              [
                piece.id,
                answer.choice === "none" ? null : (pillar?.name ?? null),
              ],
            ];
          },
        );
        return { read, costUsd };
      } catch {
        return { read: [], costUsd: 0 };
      }
    }),
  );
  return {
    pieces: Object.fromEntries(results.flatMap((result) => result.read)),
    costUsd: results.reduce((sum, result) => sum + result.costUsd, 0),
  };
}

/** The rewrite run's brief: each piece that reads as another pillar. */
export function cmoPillarRewriteMessage(input: {
  businessName: string;
  shares: readonly CmoPillarShare[];
  pieces: readonly (CmoCalendarEntry & {
    pillar: string;
    readAs: string | null;
  })[];
}): string {
  return [
    `Background run: bring ${input.businessName}'s month back to its pillars`,
    "An evaluator read every piece you made. These pillars are off the plan:",
    ...input.shares.map(
      (share) =>
        `- ${share.name}: plan ${share.planned}%, made ${share.made}% (${share.pieces} pieces)`,
    ),
    "",
    "Each piece below reads as another pillar than its entry names. Rewrite its words so it is plainly about its pillar from the first line, following your production skill. Keep its id, date, time, approach and campaign; keep its picture unless it shows something the new words no longer say, and keep a scheduled post scheduled.",
    "A Social post (by its id): get_social_post for its revision, then update_social_post. Any other piece: save_strategy part pieces with that entry's id and its new draft.",
    "",
    `Pieces (${input.pieces.length}):`,
    ...input.pieces.map(
      (piece) =>
        `- ${piece.id} · ${piece.channel}/${piece.format} · pillar ${piece.pillar} · reads as ${piece.readAs ?? "none of the pillars"} · "${piece.title}"`,
    ),
    "",
    "Then end with DONE: and one sentence for the owner. A reply without DONE: is treated as a progress note and you will be asked to continue.",
  ].join("\n");
}

/**
 * Checks a made month's pillars once, and once more after its rewrite run.
 * `startRewrite` starts the run under the given id. Safe to call from any
 * sync: a check another caller already stored is left alone.
 */
export async function advanceCmoPillars(input: {
  sokoBotId: string;
  businessName: string;
  version: { id: string; pillarCheck: unknown };
  strategy: Pick<MarketingStrategyPlan, "pillars" | "calendar">;
  runs: readonly { clientTurnId: string; status: string }[];
  runIdPrefix: string;
  ready: number;
  now: Date;
  startRewrite: (message: string, clientTurnId: string) => Promise<unknown>;
}): Promise<void> {
  const { version, strategy, now } = input;
  if (strategy.pillars.length === 0) return;
  const before = parseCmoPillarCheck(version.pillarCheck);
  if (before && (before.round === 2 || !before.rewriteRunId)) return;
  if (before) {
    const run = input.runs.find(
      (candidate) => candidate.clientTurnId === before.rewriteRunId,
    );
    if (
      !run ||
      ["STARTING", "RUNNING", "CANCEL_REQUESTED"].includes(run.status)
    )
      return;
  }
  const made = await madePieces(version, strategy.calendar);
  const read = await readCmoPillars(strategy.pillars, made);
  console.info("CMO pillar check", {
    marketingStrategyId: version.id,
    round: before ? 2 : 1,
    made: made.length,
    read: Object.keys(read.pieces).length,
    costUsd: read.costUsd,
  });
  await recordSokoBotCheckUsage({
    sokoBotId: input.sokoBotId,
    key: `cmo-pillars:${version.id}:${before ? 2 : 1}`,
    costUsd: read.costUsd,
  });
  if (Object.keys(read.pieces).length === 0) return;
  const check: CmoPillarCheck = {
    round: before ? 2 : 1,
    checkedAt: now.toISOString(),
    pieces: read.pieces,
    ...(before?.rewriteRunId ? { rewriteRunId: before.rewriteRunId } : {}),
  };
  const shares = cmoPillarShares(strategy.pillars, check);
  const rewrite =
    !before && cmoPillarsOff(shares)
      ? cmoPiecesOffPillar(strategy.pillars, strategy.calendar, check, now)
      : [];
  const runId =
    rewrite.length > 0 ? `${input.runIdPrefix}pillars:${input.ready}` : null;
  const stored = await prisma.marketingStrategy.updateMany({
    where: {
      id: version.id,
      pillarCheck: before
        ? { equals: version.pillarCheck as Prisma.InputJsonValue }
        : { equals: Prisma.DbNull },
    },
    data: {
      pillarCheck: { ...check, ...(runId ? { rewriteRunId: runId } : {}) },
    },
  });
  if (stored.count === 0 || !runId) return;
  await input.startRewrite(
    cmoPillarRewriteMessage({
      businessName: input.businessName,
      shares: shares.filter(
        (share) => Math.abs(share.made - share.planned) > CMO_SHARE_TOLERANCE,
      ),
      pieces: rewrite,
    }),
    runId,
  );
}
