import { CMO_OPENINGS_WRITING_GUIDE } from "@sokosumi/soko-bot";
import { generateText, Output } from "ai";
import { z } from "zod";
import { rethrowAiGatewayFailure } from "@/lib/ai-gateway-budget";
import { bannedCopyProblems } from "@/lib/social-post-writing";
import { modelCallTelemetryFor } from "@/lib/soko-bot/model-call-roles";
import { type sokoBotModelRequest } from "@/lib/soko-bot/model-policy";
import { askSmallModel } from "@/lib/soko-bot/small-model";

/**
 * cmo-v23-openings: after a chunk is written, one call writes four other
 * first lines for each Social post; code drops those it can check are wrong;
 * the small model judges whole posts two at a time, both ways round, and a
 * post keeps its own first line unless another wins both ways. Patrick's
 * first blind round (2026-11-26) showed that asking the writer for openings
 * in its own call changed the posts themselves, for the worse on LinkedIn.
 */

/** The networks whose readers decide on a post's first line. */
const OPENING_MAX_CHARS: Readonly<Record<string, number>> = {
  linkedin: 150,
  facebook: 125,
  instagram: 125,
  threads: 200,
  x: 200,
};
const OPENING_MIN_CHARS = 12;
/** Other first lines asked for each post. */
const ALTERNATIVES = 4;

export function cmoPicksOpeningOn(channel: string): boolean {
  return channel in OPENING_MAX_CHARS;
}

/** The text's first non-empty line. */
export function firstLineOf(text: string): string {
  return (
    text
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? ""
  );
}

/** The draft with its first non-empty line replaced by `opening`. */
export function withOpening(draft: string, opening: string): string {
  const lines = draft.split("\n");
  const at = lines.findIndex((line) => line.trim());
  if (at === -1) return draft;
  lines[at] = opening;
  return lines.join("\n");
}

const NUMBER = /\d[\d,.']*\d|\d/g;

/** Digits only, so "1,200" and "1200" match. */
function digits(value: string): string {
  return value.replace(/[,.']/g, "");
}

function numbersOf(line: string): string[] {
  return (line.match(NUMBER) ?? []).map(digits);
}

/**
 * Why an opening cannot be the post's first line, in code: too long to read
 * before the network cuts it, a question, banned copy, a hashtag, or a number
 * the post does not hold (an opening must never add a fact).
 */
export function cmoOpeningProblems(
  opening: string,
  channel: string,
  grounded: string,
): string[] {
  const problems: string[] = [];
  const max = OPENING_MAX_CHARS[channel] ?? 200;
  if (opening.length < OPENING_MIN_CHARS) problems.push("too short");
  if (opening.length > max)
    problems.push(`longer than ${max} characters, cut before it reads`);
  if (opening.trim().endsWith("?")) problems.push("a question");
  if (/(^|\s)#[\p{L}\p{N}_]/u.test(opening)) problems.push("a hashtag");
  problems.push(...bannedCopyProblems(opening));
  const known = digits(grounded);
  const invented = numbersOf(opening).filter(
    (number) => !known.includes(number),
  );
  if (invented.length > 0)
    problems.push(`a number the post does not hold (${invented.join(", ")})`);
  return problems;
}

function wordsOf(line: string): Set<string> {
  return new Set(line.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/** Share of words two lines have in common, of all words in either. */
function overlap(a: Set<string>, b: Set<string>): number {
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.max(1, new Set([...a, ...b]).size);
}

const SAME_WORDS = 0.5;

/**
 * Whether a line opens like one the month already has: on the same numbers
 * (every post opened on one customer's 15% or one price), or in mostly the
 * same words.
 */
export function cmoOpeningRepeats(
  line: string,
  taken: readonly string[],
): boolean {
  const numbers = numbersOf(line);
  const words = wordsOf(line);
  return taken.some((other) => {
    const theirs = new Set(numbersOf(other));
    return (
      (numbers.length > 0 && numbers.every((number) => theirs.has(number))) ||
      overlap(words, wordsOf(other)) >= SAME_WORDS
    );
  });
}

/**
 * The other first lines worth trying, once each: none the code finds a
 * problem in, none that repeats an opening the month already has, none the
 * same as the post's own.
 */
export function cmoOpeningAlternatives(
  draft: string,
  alternatives: readonly string[],
  channel: string,
  grounded: string,
  taken: readonly string[] = [],
): string[] {
  const seen = new Set([firstLineOf(draft).toLowerCase()]);
  return alternatives
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => {
      const key = line.toLowerCase();
      if (!line || seen.has(key)) return false;
      seen.add(key);
      return (
        !cmoOpeningRepeats(line, taken) &&
        cmoOpeningProblems(line, channel, grounded).length === 0
      );
    });
}

const openingsSchema = z.object({
  posts: z.array(z.object({ id: z.string(), openings: z.array(z.string()) })),
});

/** One call for a chunk's finished posts: four other first lines each. */
export async function cmoWriteOpenings(input: {
  request: ReturnType<typeof sokoBotModelRequest>;
  businessName: string;
  posts: readonly {
    id: string;
    channel: string;
    draft: string;
    brief: string | null;
  }[];
  proof: readonly string[];
  timeoutMs: number;
}): Promise<{
  openings: Map<string, string[]>;
  call: Awaited<ReturnType<typeof generateText>>;
}> {
  const call = await generateText({
    ...input.request,
    system: CMO_OPENINGS_WRITING_GUIDE,
    prompt: JSON.stringify({
      business: input.businessName,
      proof: input.proof,
      posts: input.posts,
      answer: `For each post by its id, exactly ${ALTERNATIVES} other first lines.`,
    }),
    output: Output.object({ schema: openingsSchema }),
    maxOutputTokens: 4_000,
    abortSignal: AbortSignal.timeout(input.timeoutMs),
    telemetry: modelCallTelemetryFor("cmo-month-writer"),
  }).catch(rethrowAiGatewayFailure);
  const { posts } = openingsSchema.parse(call.output);
  return {
    openings: new Map(
      posts.map((post) => [post.id, post.openings.slice(0, ALTERNATIVES)]),
    ),
    call,
  };
}

/** How sure a comparison is that post a reads better than post b: -1 to 1. */
export type CompareOpenings = (input: {
  a: string;
  b: string;
  channel: string;
  businessName: string;
}) => Promise<{ score: number; costUsd: number }>;

const JUDGE_RULE =
  "Which post would the brand's marketing lead rather publish? The two differ only in their first line. Judge the whole post: the first line makes the right reader stop with something concrete and true from the post, and the rest follows from it naturally, in the brand's voice. A plain, specific line beats a salesy one, and a line that sounds like an ad, leads on a price for no reason, or needs the next line to make sense loses.";

const verdictSchema = z.object({ better: z.enum(["first", "second", "same"]) });

/**
 * The small model asked twice, once each way round, so the order cannot
 * decide: 1 when a wins both times, -1 when b does, 0 otherwise.
 */
export const compareOpeningsWithSmallModel: CompareOpenings = async ({
  a,
  b,
  channel,
  businessName,
}) => {
  const ask = (first: string, second: string) =>
    askSmallModel({
      purpose: "cmo",
      system: JUDGE_RULE,
      prompt: JSON.stringify({
        network: channel,
        business: businessName,
        first,
        second,
        answer: "better: first, second or same",
      }),
      schema: verdictSchema,
    });
  const [ab, ba] = await Promise.all([ask(a, b), ask(b, a)]);
  const vote = (better: string, mine: string) =>
    better === mine ? 1 : better === "same" ? 0 : -1;
  const sum =
    vote(ab.output.better, "first") + vote(ba.output.better, "second");
  return { score: sum / 2, costUsd: ab.costUsd + ba.costUsd };
};

/**
 * How sure the judge must be before another first line replaces the post's
 * own: with the small model, a win both ways round.
 */
const REPLACE_OWN = 1;

/**
 * The post with its best first line: the other lines play each other two at
 * a time, then the winner must beat the post's own line both ways round. A
 * comparison that fails keeps the earlier post, and is counted.
 */
export async function cmoPickOpening(input: {
  draft: string;
  alternatives: readonly string[];
  channel: string;
  businessName: string;
  compare?: CompareOpenings;
}): Promise<{ draft: string; costUsd: number; failed: number }> {
  const compare = input.compare ?? compareOpeningsWithSmallModel;
  let costUsd = 0;
  let failed = 0;
  const judge = async (a: string, b: string) => {
    const result = await compare({
      a,
      b,
      channel: input.channel,
      businessName: input.businessName,
    }).catch(() => {
      failed += 1;
      return { score: 0, costUsd: 0 };
    });
    costUsd += result.costUsd;
    return result.score;
  };
  let round = input.alternatives.map((line) => withOpening(input.draft, line));
  while (round.length > 1) {
    const pairs = Array.from(
      { length: Math.ceil(round.length / 2) },
      (_, index) => round.slice(index * 2, index * 2 + 2),
    );
    round = await Promise.all(
      pairs.map(async ([a, b]) =>
        b === undefined || (await judge(a!, b)) >= 0 ? a! : b,
      ),
    );
  }
  const [challenger] = round;
  const draft =
    challenger && (await judge(challenger, input.draft)) >= REPLACE_OWN
      ? challenger
      : input.draft;
  return { draft, costUsd, failed };
}
