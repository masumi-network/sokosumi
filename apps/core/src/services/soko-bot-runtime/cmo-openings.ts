import { LINKEDIN_HOOK_RULE } from "@sokosumi/soko-bot";
import { bannedCopyProblems } from "@/lib/social-post-writing";
import { evaluateWithJev } from "@/lib/soko-bot/jev";

/**
 * cmo-v23-openings: the month writer gives every Social post four more first
 * lines; code drops those it can check are wrong, and Jev keeps the strongest
 * of the rest by comparing them two at a time, the way cmo-v11 makes several
 * pictures and picks one.
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

export function cmoPicksOpeningOn(channel: string): boolean {
  return channel in OPENING_MAX_CHARS;
}

const GENERAL_HOOK_RULE =
  "The first line makes the right reader stop scrolling: one concrete thing only this business could say (a number, a price, a named customer and what they did, a result, or a decision that sounds surprising), in plain words. A statement beats a promise. Advice any business could give, a question, hype or a vague benefit is weaker.";

function hookRule(channel: string): string {
  return channel === "linkedin" ? LINKEDIN_HOOK_RULE : GENERAL_HOOK_RULE;
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

/**
 * Why an opening cannot be the post's first line, in code: too long to read
 * before the network cuts it, a question, banned copy, a hashtag, or a number
 * the piece does not hold (an alternative must never invent a fact).
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
  const invented = (opening.match(NUMBER) ?? []).filter(
    (number) => !known.includes(digits(number)),
  );
  if (invented.length > 0)
    problems.push(`a number the piece does not hold (${invented.join(", ")})`);
  return problems;
}

/**
 * The first lines worth comparing: the draft's own first, then each
 * alternative code finds no problem in, once each. The draft's own line
 * stays a candidate even with a problem, since the draft already has it.
 */
export function cmoOpeningCandidates(
  draft: string,
  alternatives: readonly string[],
  channel: string,
  grounded: string,
): string[] {
  const own = firstLineOf(draft);
  const seen = new Set([own.toLowerCase()]);
  const fresh = alternatives
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => {
      const key = line.toLowerCase();
      if (!line || seen.has(key)) return false;
      seen.add(key);
      return cmoOpeningProblems(line, channel, grounded).length === 0;
    });
  return own ? [own, ...fresh] : fresh;
}

/** How much more likely "a beats b" must be than "b beats a" to win. */
const COMPARE_MARGIN = 0;

export type CompareOpenings = (input: {
  a: string;
  b: string;
  channel: string;
  businessName: string;
}) => Promise<{ aWins: boolean; costUsd: number }>;

/**
 * Jev asked both ways round, so the order the lines come in cannot decide:
 * a wins when "a is stronger" is more likely than "b is stronger". A tie
 * keeps a, the line closer to the draft's own.
 */
export const compareOpeningsWithJev: CompareOpenings = async ({
  a,
  b,
  channel,
  businessName,
}) => {
  const rule = hookRule(channel);
  const ask = (first: string, second: string) =>
    `Two first lines for the same ${channel} post by ${businessName}: ${first} and ${second}. Judged by this rule, is ${first} the stronger first line? ${rule}`;
  const { answers, costUsd } = await evaluateWithJev({
    state: { channel, businessName, lineA: a, lineB: b },
    questions: {
      aFirst: { type: "boolean", instructions: ask("lineA", "lineB") },
      bFirst: { type: "boolean", instructions: ask("lineB", "lineA") },
    },
    timeoutMs: 15_000,
  });
  const yes = (key: string) => {
    const answer = answers.get(key);
    return answer?.type === "boolean" ? answer.probability : 0.5;
  };
  return { aWins: yes("aFirst") - yes("bFirst") >= COMPARE_MARGIN, costUsd };
};

/**
 * The strongest of the candidates by a knockout of pairwise comparisons
 * (five lines: four comparisons in three rounds). A comparison that fails
 * keeps the earlier line, so the draft's own line wins when Jev is away.
 */
export async function cmoPickOpening(input: {
  candidates: readonly string[];
  channel: string;
  businessName: string;
  compare?: CompareOpenings;
}): Promise<{ opening: string | null; costUsd: number }> {
  const compare = input.compare ?? compareOpeningsWithJev;
  let round = [...input.candidates];
  let costUsd = 0;
  while (round.length > 1) {
    const pairs = Array.from(
      { length: Math.ceil(round.length / 2) },
      (_, index) => round.slice(index * 2, index * 2 + 2),
    );
    round = await Promise.all(
      pairs.map(async ([a, b]) => {
        if (b === undefined) return a!;
        const result = await compare({
          a: a!,
          b,
          channel: input.channel,
          businessName: input.businessName,
        }).catch(() => ({ aWins: true, costUsd: 0 }));
        costUsd += result.costUsd;
        return result.aWins ? a! : b;
      }),
    );
  }
  return { opening: round[0] ?? null, costUsd };
}
