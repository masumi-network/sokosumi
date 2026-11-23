import {
  type BrandBrain,
  type CmoCalendarEntry,
  getSokoBotVersion,
  type MarketingStrategyPlan,
  cmoMarksPoints as versionMarksPoints,
} from "@sokosumi/soko-bot";
import { generateText, Output } from "ai";
import { z } from "zod";
import { rethrowAiGatewayFailure } from "@/lib/ai-gateway-budget";
import { modelCallTelemetryFor } from "@/lib/soko-bot/model-call-roles";
import { type sokoBotModelRequest } from "@/lib/soko-bot/model-policy";
import { compactBrandBrain } from "@/services/brand-brain.service";
import { cmoPieceIsTalking } from "@/services/cmo-media-maker.service";

/**
 * cmo-v20: Core gives every piece of the month the one point it argues before
 * the writer's chunks run, and marks the offer pieces the funnel promises.
 * entry.fyi's cmo-v15 month (2026-11-22): 112 of 151 entries had no claim,
 * the chunks ran at once without seeing each other, and "you approve what
 * goes live" carried 18 of 96 X posts while 2 carried the offer's link.
 */

/** Whether a Cuso version's writer gives each piece its point (cmo-v20). */
export function cmoMarksPoints(versionId: string | null | undefined): boolean {
  return versionMarksPoints(getSokoBotVersion(versionId).skills);
}

/** Offer pieces a week on each network the funnel's action stage names. */
export const CMO_OFFER_PIECES_PER_WEEK = 2;

/** Networks whose post carries its link in the first comment. */
const LINK_IN_COMMENT = new Set(["x", "linkedin", "facebook"]);
/** Networks whose post points to the link in the profile's bio. */
const LINK_IN_BIO = new Set(["instagram", "tiktok"]);

const ACTION_STAGES = new Set(["action", "conversion"]);
const OFFER_APPROACHES = ["promotional", "product-led"];

type Entry = CmoCalendarEntry;

function live(entry: Entry): boolean {
  return entry.status !== "skipped" && entry.status !== "published";
}

/** A piece the writer writes words for itself: not a video's copy. */
function ownPiece(entry: Entry): boolean {
  return live(entry) && !entry.videoOf && !cmoPieceIsTalking(entry);
}

function weekOf(date: string, start: string): number {
  const days =
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
    86_400_000;
  return Math.floor(days / 7);
}

/**
 * The pieces that carry the offer, the same set on every call: on each
 * network of the funnel's action stage, CMO_OFFER_PIECES_PER_WEEK a week,
 * promotional and product-led pieces first, on different days.
 */
export function cmoOfferPieceIds(
  strategy: Pick<MarketingStrategyPlan, "funnel" | "calendar">,
): Set<string> {
  const channels = new Set(
    (strategy.funnel ?? [])
      .filter((stage) => ACTION_STAGES.has(stage.stage))
      .flatMap((stage) => stage.channels ?? [])
      .filter(
        (channel) => LINK_IN_COMMENT.has(channel) || LINK_IN_BIO.has(channel),
      ),
  );
  const pieces = strategy.calendar.filter(
    (entry) => ownPiece(entry) && channels.has(entry.channel),
  );
  const start = pieces.map((entry) => entry.date).sort()[0];
  if (!start) return new Set();
  const groups = new Map<string, Entry[]>();
  for (const entry of pieces) {
    const key = `${entry.channel}:${weekOf(entry.date, start)}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const rank = (entry: Entry) => {
    const at = OFFER_APPROACHES.indexOf(entry.approach ?? "");
    return at === -1 ? OFFER_APPROACHES.length : at;
  };
  const picked = new Set<string>();
  for (const group of groups.values()) {
    const ordered = [...group].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        `${a.date}${a.time ?? ""}${a.id}`.localeCompare(
          `${b.date}${b.time ?? ""}${b.id}`,
        ),
    );
    const days = new Set<string>();
    for (const pass of [true, false])
      for (const entry of ordered) {
        if (days.size >= CMO_OFFER_PIECES_PER_WEEK) break;
        if (picked.has(entry.id) || (pass && days.has(entry.date))) continue;
        picked.add(entry.id);
        days.add(entry.date);
      }
  }
  return picked;
}

/** What an offer piece is told: the action, and where its link goes. */
export function cmoOfferLine(
  channel: string,
  offer: MarketingStrategyPlan["offer"],
  websiteUrl: string,
): string {
  const action = offer?.action?.trim() || "the offer's action";
  if (LINK_IN_COMMENT.has(channel))
    return `offer piece: it ends with "${action}" and says the link is below; firstComment holds the link (${websiteUrl})`;
  if (LINK_IN_BIO.has(channel))
    return `offer piece: it ends with "${action}" and says the link is in the bio`;
  return `offer piece: it ends with "${action}"`;
}

/** Why an offer piece as written misses its link, or null. */
export function cmoOfferLinkProblem(
  channel: string,
  written: { draft: string | null; firstComment: string | null },
): string | null {
  if (!written.draft?.trim()) return null;
  if (
    LINK_IN_COMMENT.has(channel) &&
    !/https?:\/\//.test(written.firstComment ?? "")
  )
    return "It is an offer piece: put the link to the offer in firstComment and end the post with the offer's action.";
  if (LINK_IN_BIO.has(channel) && !/\bbio\b/i.test(written.draft))
    return "It is an offer piece: end with the offer's action and say the link is in the bio.";
  return null;
}

/** How often one point may lead pieces on one network in the month. */
export function cmoPointCap(networkPieces: number): number {
  return Math.max(2, Math.ceil(networkPieces / 16));
}

function key(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const pointsSchema = z.object({
  facts: z.array(z.object({ id: z.string(), fact: z.string() })),
  points: z.array(
    z.object({
      id: z.string(),
      pillar: z.string(),
      factId: z.string(),
      point: z.string(),
    }),
  ),
  pieces: z.array(z.object({ id: z.string(), point: z.string() })),
});

/** A point of the month and the id of the one fact it rests on. */
export interface CmoPoint {
  id: string;
  pillar: string;
  factId: string;
  point: string;
}

/**
 * Each piece's point from the model's picks, held to cmoPointCap per
 * network by the fact it rests on: the model words one fact as several
 * points ("You approve what goes live", "Nothing changes until you say
 * yes") and quotes it from several Brand Brain sentences, so it first lists
 * each fact once and every point names its fact's id. A piece over the cap
 * moves to the least used point of its pillar, then of the month.
 */
export function cmoCapPoints(input: {
  calendar: readonly Entry[];
  points: readonly CmoPoint[];
  picks: ReadonlyMap<string, string>;
}): Map<string, string> {
  const byId = new Map(input.points.map((point) => [point.id, point]));
  const count = new Map<string, number>();
  const used = (channel: string, fact: string) =>
    count.get(`${channel}|${key(fact)}`) ?? 0;
  const bump = (channel: string, fact: string) =>
    count.set(`${channel}|${key(fact)}`, used(channel, fact) + 1);
  const pieces = input.calendar.filter(ownPiece);
  const onNetwork = new Map<string, number>();
  for (const entry of pieces)
    onNetwork.set(entry.channel, (onNetwork.get(entry.channel) ?? 0) + 1);
  // A claim already taken counts by its own words, or its point's fact.
  const factOf = new Map(
    input.points.map((point) => [key(point.point), point.factId]),
  );
  for (const entry of pieces)
    if (entry.claim?.trim())
      bump(entry.channel, factOf.get(key(entry.claim)) ?? entry.claim);
  const claims = new Map<string, string>();
  for (const entry of pieces) {
    if (entry.claim?.trim()) continue;
    const picked = byId.get(input.picks.get(entry.id) ?? "");
    if (!picked) continue;
    const cap = cmoPointCap(onNetwork.get(entry.channel) ?? 0);
    const open = input.points
      .filter((point) => used(entry.channel, point.factId) < cap)
      .sort(
        (a, b) =>
          Number(b.pillar === picked.pillar) -
            Number(a.pillar === picked.pillar) ||
          used(entry.channel, a.factId) - used(entry.channel, b.factId),
      );
    const point = used(entry.channel, picked.factId) < cap ? picked : open[0];
    if (!point) continue;
    claims.set(entry.id, point.point);
    bump(entry.channel, point.factId);
  }
  return claims;
}

/** The pieces that still need a point: social pieces without a claim. */
export function cmoUnclaimed(calendar: readonly Entry[]): Entry[] {
  return calendar.filter((entry) => ownPiece(entry) && !entry.claim?.trim());
}

/** The points call's instructions and the month it plans. */
export function cmoPointsPrompt(
  strategy: MarketingStrategyPlan,
  brain: BrandBrain | null,
  proof: readonly string[],
  only: ReadonlySet<string>,
): { system: string; prompt: string } {
  const open = cmoUnclaimed(strategy.calendar).filter((entry) =>
    only.has(entry.id),
  );
  const taken = strategy.calendar
    .filter((entry) => ownPiece(entry) && entry.claim?.trim())
    .map(
      (entry) => `- ${entry.channel} · ${entry.pillar ?? ""}: ${entry.claim}`,
    );
  const networks = new Map<string, number>();
  for (const entry of strategy.calendar.filter(ownPiece))
    networks.set(entry.channel, (networks.get(entry.channel) ?? 0) + 1);
  return {
    system: [
      "You plan what each piece of a month of marketing argues, before anyone writes it.",
      "A point is one sentence a reader can agree or disagree with, built on one fact from the Brand Brain or the offer: a feature by its name, a price, a number, a customer, a date, a decision the business made. Never a topic and never the title again. Never invent a fact.",
      "First list the facts: every distinct fact the Brand Brain and the offer hold that a piece could rest on, each once with an id. The Brand Brain often says one thing in several places ('You approve what goes live', 'Suggested changes wait for your approval'): that is one fact, listed once.",
      "Then list the points pillar by pillar, as many different ones as each pillar's pieces need, each naming the id of the one fact it rests on. Points on one fact are one message in other words, so a pillar needs as many facts as messages. The offer's proof lines are facts like any other, not a message for every piece.",
      `Then give every listed piece the id of its point. One fact leads at most ${[
        ...networks,
      ]
        .map(([channel, n]) => `${cmoPointCap(n)} pieces on ${channel}`)
        .join(
          ", ",
        )} in the month, counting the claims already taken, and never two pieces of one network in the same week. A piece's point belongs to its pillar and suits its title and approach.`,
      "A LinkedIn piece's point rests on a story (a named customer, the founder or the team did something and something came of it), a result, or a decision the business made and why; a feature alone is not enough there. When those run out, a number from the business worked out for the reader.",
    ].join("\n\n"),
    prompt: [
      "Brand Brain:",
      JSON.stringify(compactBrandBrain(brain)),
      proof.length > 0
        ? ["Named proof:", ...proof.map((point) => `- ${point}`)].join("\n")
        : "",
      "Strategy:",
      JSON.stringify({
        idea: strategy.idea,
        offer: strategy.offer,
        pillars: strategy.pillars,
        contentLanguage: strategy.contentLanguage,
      }),
      taken.length > 0 ? ["Claims already taken:", ...taken].join("\n") : "",
      "Pieces that need a point:",
      ...open.map(
        (entry) =>
          `- ${entry.id} · ${entry.date} ${entry.channel}/${entry.format} · ${entry.approach ?? ""} · ${entry.pillar ?? ""} · "${entry.title}"${entry.brief ? ` · brief: ${entry.brief}` : ""}`,
      ),
      `Write the points in ${strategy.contentLanguage ?? "the strategy's language"}.`,
    ]
      .filter((line) => line !== "")
      .join("\n"),
  };
}

/**
 * Asks the model for the month's points and each unclaimed piece's pick,
 * then caps them. Returns nothing when the call fails or runs out of time:
 * the writer then works as before.
 */
export async function assignCmoPoints(input: {
  request: ReturnType<typeof sokoBotModelRequest>;
  strategy: MarketingStrategyPlan;
  brain: BrandBrain | null;
  proof: readonly string[];
  /** The pieces this call writes; the month's other claims stay as taken. */
  only: ReadonlySet<string>;
  timeoutMs: number;
}): Promise<{
  claims: Map<string, string>;
  call: Awaited<ReturnType<typeof generateText>> | null;
}> {
  const { strategy } = input;
  const open = cmoUnclaimed(strategy.calendar).filter((entry) =>
    input.only.has(entry.id),
  );
  if (open.length === 0 || input.timeoutMs <= 0)
    return { claims: new Map(), call: null };
  const { system, prompt } = cmoPointsPrompt(
    strategy,
    input.brain,
    input.proof,
    input.only,
  );
  const result = await generateText({
    ...input.request,
    system,
    prompt,
    output: Output.object({ schema: pointsSchema }),
    maxOutputTokens: 12_000,
    abortSignal: AbortSignal.timeout(input.timeoutMs),
    telemetry: modelCallTelemetryFor("cmo-month-writer"),
  }).catch(rethrowAiGatewayFailure);
  const answer = pointsSchema.parse(result.output);
  return {
    claims: cmoCapPoints({
      calendar: strategy.calendar,
      points: answer.points,
      picks: new Map(answer.pieces.map((piece) => [piece.id, piece.point])),
    }),
    call: result,
  };
}
