import { Prisma } from "@sokosumi/database";
import {
  type BrandBrain,
  type CmoCalendarEntry,
  type CmoPillar,
  judgedWritingRules,
  type MarketingStrategyPlan,
  writingSkillsBrief,
} from "@sokosumi/soko-bot";
import { z } from "zod";

import prisma from "@/lib/db/prisma";
import {
  evaluateWithJev,
  type JevAnswer,
  type JevQuestion,
} from "@/lib/soko-bot/jev";
import {
  CMO_SHARE_TOLERANCE,
  samePillar,
} from "@/services/cmo-plan-review.service";
import { isMarketingFilePiece } from "@/services/marketing-strategy.service";
import { readMarketingPieceText } from "@/services/marketing-strategy-files.service";
import { recordSokoBotCheckUsage } from "@/services/soko-bot-billing.service";

/**
 * Once the month is made, Jev, a separate evaluation model, reads every
 * piece: which pillar it is really about, whether it follows its network's
 * writing skill, and whether it sounds like the brand. A calendar can hold
 * the pillars while the words drift to one favourite topic, and a month of
 * forty pieces drifts from the skills and the voice. Pieces still to come
 * that miss get one rewrite run; after it, Jev reads the month again for the
 * owner and nothing more is rewritten.
 */

/** What Jev read the month as; stored on the approved version. */
export const cmoMonthReviewSchema = z.object({
  /** 1 after the made month, 2 after the rewrite run. */
  round: z.number().int().min(1).max(2),
  checkedAt: z.string(),
  /** Entry id → the pillar its words are about, or null for none of them. */
  pieces: z.record(z.string(), z.string().nullable()),
  /**
   * Entry id → whether Jev read its words as following its writing skill and
   * the brand voice, and what Core's own count found wrong.
   */
  writing: z
    .record(
      z.string(),
      z.object({
        followsSkill: z.boolean(),
        soundsLikeBrand: z.boolean(),
        /** The skill's rules Jev read it as missing. */
        missed: z.array(z.string()).default([]),
        problems: z.array(z.string()).default([]),
      }),
    )
    .default({}),
  /** The rewrite run this review started, by its client turn id. */
  rewriteRunId: z.string().optional(),
});
export type CmoMonthReview = z.infer<typeof cmoMonthReviewSchema>;

export function parseCmoMonthReview(value: unknown): CmoMonthReview | null {
  const parsed = cmoMonthReviewSchema.safeParse(value);
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
  review: Pick<CmoMonthReview, "pieces">,
): CmoPillarShare[] {
  const read = Object.values(review.pieces);
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

export type CmoPieceToRewrite = CmoCalendarEntry & {
  reasons: string[];
  /** Its words read as another pillar than its entry names. */
  offPillar: boolean;
};

/**
 * Pieces still to come that the rewrite run fixes, each with why: words that
 * read as another pillar (only when the month's shares are off), words that
 * miss their network's skill, or words that do not sound like the brand. A
 * published piece stays as it is, and so does a pillar Jev cannot rewrite
 * towards: an older plan's entries sometimes named none of its pillars.
 */
export function cmoPiecesToRewrite(
  strategy: Pick<MarketingStrategyPlan, "pillars" | "calendar">,
  review: CmoMonthReview,
  now: Date,
): CmoPieceToRewrite[] {
  const today = now.toISOString().slice(0, 10);
  const pillarsOff = cmoPillarsOff(cmoPillarShares(strategy.pillars, review));
  return strategy.calendar.flatMap((entry) => {
    if (entry.status === "published" || entry.date < today) return [];
    const reasons: string[] = [];
    let offPillar = false;
    const planned = strategy.pillars.find(
      (pillar) => entry.pillar && samePillar(entry.pillar, pillar.name),
    );
    if (pillarsOff && planned && entry.id in review.pieces) {
      const readAs = review.pieces[entry.id] ?? null;
      offPillar = !readAs || !samePillar(readAs, planned.name);
      if (offPillar)
        reasons.push(
          `pillar ${planned.name}, but reads as ${readAs ?? "none of the pillars"}`,
        );
    }
    const writing = review.writing[entry.id];
    if (writing && !writing.followsSkill)
      reasons.push(
        ...(writing.missed.length > 0
          ? writing.missed.map((rule) => `misses "${rule}"`)
          : ["misses its network's writing skill"]),
      );
    if (writing) reasons.push(...writing.problems);
    if (writing && !writing.soundsLikeBrand)
      reasons.push("does not sound like the brand");
    return reasons.length > 0 ? [{ ...entry, reasons, offPillar }] : [];
  });
}

/** Jev reads a piece's opening; enough to tell its topic and its shape. */
const READ_CHARS = 1_500;
/** A piece asks one question per rule, so a batch holds only a few pieces. */
const PIECES_PER_CHECK = 3;
/** Below this Jev is fairly sure a rule is missed; a coin flip is not worth a rewrite. */
const PASS_PROBABILITY = 0.35;

export interface CmoMadePiece {
  id: string;
  channel: string;
  format: string;
  title: string;
  /** Its opening, for Jev. */
  text: string;
  /** What Core's count found wrong in the whole text. */
  problems: string[];
}

function field(text: string, name: string): string | null {
  return fields(text, name)[0] ?? null;
}

/** Every value of a labelled line, such as each card's Headline. */
function fields(text: string, name: string): string[] {
  return [...text.matchAll(new RegExp(`^${name}:[ \\t]*(.+)$`, "gim"))].map(
    (match) => (match[1] ?? "").trim(),
  );
}

/** Meta shows this much of the primary text before "more". */
const META_VISIBLE_CHARS = 125;

function lengthProblem(
  name: string,
  value: string | null,
  [min, max]: readonly [number, number],
  aim: string,
): string | null {
  if (value === null) return `it has no ${name} line`;
  if (value.length < min || value.length > max)
    return `its ${name} is ${value.length} characters; make it ${aim}`;
  return null;
}

/** A Meta ad's point fits before "more", and each headline in Meta's range. */
function metaAdProblems(text: string): (string | null)[] {
  const primary = field(text, "Primary text");
  const point = primary?.split(/(?<=[.!?])\s/)[0] ?? "";
  const headlines = fields(text, "Headline");
  return [
    primary === null
      ? "it has no Primary text line"
      : point.length > META_VISIBLE_CHARS
        ? `its primary text's first sentence is ${point.length} characters; make its point fit in ${META_VISIBLE_CHARS}`
        : null,
    headlines.length === 0 ? "it has no Headline line" : null,
    ...headlines.map((headline) =>
      headline.length > 40
        ? `its headline "${headline.slice(0, 30)}…" is ${headline.length} characters; make it at most 40`
        : null,
    ),
  ];
}

/**
 * The counted rules of a file piece's skill, checked in code because Jev
 * cannot count. Social posts are counted when they are saved, and a search
 * ad's parts when its searchAd is.
 */
export function cmoCountedProblems(
  channel: string,
  format: string,
  text: string,
): string[] {
  const problems =
    channel === "meta_ads"
      ? metaAdProblems(text)
      : channel === "google_ads" && format === "display_ad"
        ? [
            lengthProblem(
              "Short headline",
              field(text, "Short headline"),
              [5, 30],
              "at most 30",
            ),
            lengthProblem(
              "Long headline",
              field(text, "Long headline"),
              [10, 90],
              "at most 90",
            ),
            lengthProblem(
              "Description",
              field(text, "Description"),
              [10, 90],
              "at most 90",
            ),
          ]
        : channel === "seo" && format === "page_fix"
          ? [
              lengthProblem(
                "Title",
                field(text, "Title"),
                [10, 60],
                "at most 60",
              ),
              lengthProblem(
                "Description",
                field(text, "Description"),
                [100, 160],
                "120 to 155",
              ),
            ]
          : channel === "seo" && format === "article"
            ? [
                lengthProblem(
                  "Description",
                  field(text, "Description"),
                  [100, 160],
                  "120 to 155",
                ),
                /^# \S/m.test(text) ? null : "it has no # title",
                /^(#+ )?\**Link from\**:\**\s*\S/im.test(text)
                  ? null
                  : "it has no Link from: line naming the pages that should link to it",
              ]
            : channel === "newsletter"
              ? [
                  lengthProblem(
                    "Subject",
                    field(text, "Subject"),
                    [15, 60],
                    "30 to 50",
                  ),
                  field(text, "Preview") ? null : "it has no Preview line",
                ]
              : [];
  return problems.filter((problem) => problem !== null);
}

/** The month's made pieces and their words: a post's text or a file's. */
async function madePieces(
  version: { id: string },
  calendar: readonly CmoCalendarEntry[],
): Promise<CmoMadePiece[]> {
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
        ? {
            id: entry.id,
            channel: entry.channel,
            format: entry.format,
            title: entry.title,
            text: text.slice(0, READ_CHARS),
            problems: cmoCountedProblems(entry.channel, entry.format, text),
          }
        : null;
    }),
  );
  return pieces.filter((piece) => piece !== null);
}

function passes(
  answers: ReadonlyMap<string, JevAnswer>,
  key: string,
): boolean | null {
  const answer = answers.get(key);
  return answer?.type === "boolean"
    ? answer.probability >= PASS_PROBABILITY
    : null;
}

/**
 * What the pieces' facts are checked against: what the business sells, charges
 * and has proven, and the approved plan's offer, which its pieces state.
 */
export type CmoBrandFacts = Pick<
  BrandBrain,
  "summary" | "products" | "offers"
> &
  Pick<
    NonNullable<BrandBrain["profile"]>,
    "proof" | "pricing" | "customers" | "reputation"
  > & {
    customerQuotes: string[];
    planOffer: MarketingStrategyPlan["offer"];
  };

export function cmoBrandFacts(
  brain: BrandBrain,
  planOffer: MarketingStrategyPlan["offer"],
): CmoBrandFacts {
  return {
    summary: brain.summary,
    products: brain.products,
    offers: brain.offers,
    customerQuotes: (brain.voiceOfCustomer ?? []).map((quote) => quote.quote),
    proof: brain.profile?.proof,
    pricing: brain.profile?.pricing,
    customers: brain.profile?.customers,
    reputation: brain.profile?.reputation,
    planOffer,
  };
}

/**
 * Jev's reading of each piece, a few pieces per question set: its pillar, and
 * whether it follows its skill and the brand voice. A batch Jev fails leaves
 * its pieces out, never in a wrong pillar or marked for a rewrite.
 */
export async function readCmoMonth(input: {
  pillars: readonly CmoPillar[];
  voice: BrandBrain["voice"] | null;
  facts?: CmoBrandFacts | null;
  pieces: readonly CmoMadePiece[];
}): Promise<Pick<CmoMonthReview, "pieces" | "writing"> & { costUsd: number }> {
  const { pillars, voice, facts } = input;
  const criteria = Object.fromEntries([
    ...pillars.map((pillar, index) => [
      `p${index}`,
      pillar.why ? `${pillar.name}: ${pillar.why}` : pillar.name,
    ]),
    ["none", "None of these topics"],
  ]);
  const batches: CmoMadePiece[][] = [];
  for (let index = 0; index < input.pieces.length; index += PIECES_PER_CHECK)
    batches.push(input.pieces.slice(index, index + PIECES_PER_CHECK));
  const results = await Promise.all(
    batches.map(async (batch) => {
      const questions = Object.fromEntries(
        batch.flatMap((_, index): [string, JevQuestion][] => [
          ...(pillars.length > 0
            ? [
                [
                  `pillar${index}`,
                  {
                    type: "choice",
                    instructions: `Which pillar is piece ${index} mostly about, judged by its text rather than its title?`,
                    criteria,
                  },
                ] satisfies [string, JevQuestion],
              ]
            : []),
          // One question per rule: asked all at once, Jev's doubts add up and good pieces fail.
          ...judgedWritingRules(
            batch[index]!.channel,
            batch[index]!.format,
          ).map((rule, ruleIndex): [string, JevQuestion] => [
            `rule${index}_${ruleIndex}`,
            {
              type: "boolean",
              instructions: `Does the text of piece ${index} follow this rule? ${rule}`,
            },
          ]),
          ...(voice
            ? [
                [
                  `voice${index}`,
                  {
                    type: "boolean",
                    instructions: `Does the text of piece ${index} sound like the brand voice (its tone, its do rules and its examples) and break none of its don't rules?`,
                  },
                ] satisfies [string, JevQuestion],
              ]
            : []),
        ]),
      );
      try {
        const { answers, costUsd } = await evaluateWithJev({
          state: {
            pillars: pillars.map((pillar) => pillar.name),
            ...(voice ? { brandVoice: voice } : {}),
            ...(facts ? { brandFacts: facts } : {}),
            pieces: batch.map((piece, index) => ({
              piece: index,
              network: piece.channel,
              format: piece.format,
              title: piece.title,
              text: piece.text,
            })),
          },
          questions,
          timeoutMs: 30_000,
        });
        const read = batch.flatMap(
          (piece, index): [string, string | null][] => {
            const answer = answers.get(`pillar${index}`);
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
        const writing = batch.flatMap(
          (piece, index): [string, CmoMonthReview["writing"][string]][] => {
            const verdicts = judgedWritingRules(
              piece.channel,
              piece.format,
            ).map((rule, ruleIndex) => ({
              rule,
              pass: passes(answers, `rule${index}_${ruleIndex}`),
            }));
            if (verdicts.every((verdict) => verdict.pass === null)) return [];
            const missed = verdicts
              .filter((verdict) => verdict.pass === false)
              .map((verdict) => verdict.rule);
            return [
              [
                piece.id,
                {
                  followsSkill: missed.length === 0,
                  missed,
                  soundsLikeBrand: voice
                    ? (passes(answers, `voice${index}`) ?? true)
                    : true,
                  problems: piece.problems,
                },
              ],
            ];
          },
        );
        return { read, writing, costUsd };
      } catch {
        return { read: [], writing: [], costUsd: 0 };
      }
    }),
  );
  return {
    pieces: Object.fromEntries(results.flatMap((result) => result.read)),
    writing: Object.fromEntries(results.flatMap((result) => result.writing)),
    costUsd: results.reduce((sum, result) => sum + result.costUsd, 0),
  };
}

/** The rewrite run's brief: each piece with what to fix, and the skills to fix it by. */
export function cmoRewriteMessage(input: {
  businessName: string;
  shares: readonly CmoPillarShare[];
  pieces: readonly CmoPieceToRewrite[];
}): string {
  // The shares only matter to Cuso when a piece here is off its pillar.
  const off = input.pieces.some((piece) => piece.offPillar)
    ? input.shares.filter(
        (share) => Math.abs(share.made - share.planned) > CMO_SHARE_TOLERANCE,
      )
    : [];
  return [
    `Background run: rewrite pieces in ${input.businessName}'s month`,
    "An evaluator read every piece you made. The pieces below miss their pillar, their network's writing skill or the brand's voice. Rewrite each one's words to fix what its line says, following your production skill and the writing skills below. Change only what a piece's line names: keep its other sentences, its facts from the Brand Brain and the plan's offer, and its labelled lines as they are.",
    ...(off.length > 0
      ? [
          "",
          "These pillars are off the plan:",
          ...off.map(
            (share) =>
              `- ${share.name}: plan ${share.planned}%, made ${share.made}% (${share.pieces} pieces)`,
          ),
          "A piece off its pillar must be plainly about its pillar from the first line.",
        ]
      : []),
    "",
    "Keep each piece's id, date, time, approach and campaign; keep its picture unless it shows something the new words no longer say, and keep a scheduled post scheduled.",
    "A Social post (by its id): get_social_post for its revision, then update_social_post. Any other piece: save_strategy part pieces with that entry's id and its new draft.",
    "",
    `Pieces (${input.pieces.length}):`,
    ...input.pieces.map(
      (piece) =>
        `- ${piece.id} · ${piece.channel}/${piece.format} · "${piece.title}" · ${piece.reasons.join("; ")}`,
    ),
    "",
    writingSkillsBrief(input.pieces.map((piece) => piece.channel)),
    "",
    "Then end with DONE: and one sentence for the owner. A reply without DONE: is treated as a progress note and you will be asked to continue.",
  ].join("\n");
}

/**
 * Reviews a made month once, and once more after its rewrite run.
 * `startRewrite` starts the run under the given id. Safe to call from any
 * sync: a review another caller already stored is left alone.
 */
export async function advanceCmoMonthReview(input: {
  sokoBotId: string;
  businessName: string;
  version: { id: string; monthReview: unknown };
  strategy: Pick<MarketingStrategyPlan, "pillars" | "calendar">;
  voice: BrandBrain["voice"] | null;
  facts?: CmoBrandFacts | null;
  runs: readonly { clientTurnId: string; status: string }[];
  runIdPrefix: string;
  ready: number;
  now: Date;
  startRewrite: (message: string, clientTurnId: string) => Promise<unknown>;
}): Promise<void> {
  const { version, strategy, now } = input;
  const before = parseCmoMonthReview(version.monthReview);
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
  const round = before ? 2 : 1;
  const made = await madePieces(version, strategy.calendar);
  if (made.length === 0) return;
  const read = await readCmoMonth({
    pillars: strategy.pillars,
    voice: input.voice,
    facts: input.facts,
    pieces: made,
  });
  console.info("CMO month review", {
    marketingStrategyId: version.id,
    round,
    made: made.length,
    read: Object.keys(read.writing).length,
    offSkill: Object.values(read.writing).filter(
      (w) => !w.followsSkill || w.problems.length > 0,
    ).length,
    offVoice: Object.values(read.writing).filter((w) => !w.soundsLikeBrand)
      .length,
    costUsd: read.costUsd,
  });
  await recordSokoBotCheckUsage({
    sokoBotId: input.sokoBotId,
    key: `cmo-review:${version.id}:${round}`,
    costUsd: read.costUsd,
  });
  if (
    Object.keys(read.pieces).length === 0 &&
    Object.keys(read.writing).length === 0
  )
    return;
  const review: CmoMonthReview = {
    round,
    checkedAt: now.toISOString(),
    pieces: read.pieces,
    writing: read.writing,
    ...(before?.rewriteRunId ? { rewriteRunId: before.rewriteRunId } : {}),
  };
  const rewrite = before ? [] : cmoPiecesToRewrite(strategy, review, now);
  const runId =
    rewrite.length > 0 ? `${input.runIdPrefix}review:${input.ready}` : null;
  const stored = await prisma.marketingStrategy.updateMany({
    where: {
      id: version.id,
      monthReview: before
        ? { equals: version.monthReview as Prisma.InputJsonValue }
        : { equals: Prisma.DbNull },
    },
    data: {
      monthReview: { ...review, ...(runId ? { rewriteRunId: runId } : {}) },
    },
  });
  if (stored.count === 0 || !runId) return;
  await input.startRewrite(
    cmoRewriteMessage({
      businessName: input.businessName,
      shares: cmoPillarShares(strategy.pillars, review),
      pieces: rewrite,
    }),
    runId,
  );
}
