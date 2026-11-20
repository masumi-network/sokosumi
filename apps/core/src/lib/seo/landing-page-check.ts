import {
  MIN_SUPPORT,
  unsupportedNumbers,
  withoutDates,
} from "@/lib/competitors/feed-check";
import { evaluateWithJev } from "@/lib/soko-bot/jev";

/** A page may say this much about the competitor: each sentence is checked. */
export const COMPETITOR_SENTENCES_MAX = 20;
const JEV_TIMEOUT_MS = 30_000;
/** Never in anything the owner reads on CMO: it is its own product. */
const SOKOSUMI = /sokosumi/i;

/** Text as searches compare: lower case, words only. */
export function flat(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const isTableRow = (line: string) => line.trimStart().startsWith("|");

/** A page's H1 and its first paragraph, as its Markdown gives them. */
export function pageOpening(draft: string): {
  heading: string | null;
  firstParagraph: string | null;
} {
  const lines = draft
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const [first = "", ...rest] = lines;
  return {
    heading: first.startsWith("# ") ? first.slice(2).trim() : null,
    firstParagraph:
      rest.find(
        (line) => !/^(#|[-*+] |\d+\. |>|\||!\[|---)/.test(line.trimStart()),
      ) ?? null,
  };
}

/**
 * What a page says about a competitor: each sentence that names it, and each
 * row of a table whose heading row names it, with that heading row.
 */
export function competitorStatements(
  draft: string,
  competitor: string,
): string[] {
  const name = flat(competitor);
  const names = (text: string) => ` ${flat(text)} `.includes(` ${name} `);
  const statements: string[] = [];
  let tableHead: string | null = null;
  for (const line of draft.split("\n")) {
    if (isTableRow(line)) {
      if (tableHead === null) {
        tableHead = line;
        continue;
      }
      if (/^[\s|:-]+$/.test(line)) continue;
      if (names(tableHead) || names(line))
        statements.push(`${tableHead.trim()}\n${line.trim()}`);
      continue;
    }
    tableHead = null;
    const text = line.replace(/^\s*(#+|[-*+]|\d+\.|>)\s+/, "");
    for (const sentence of text.split(/(?<=[.!?])\s+/))
      if (sentence.trim() && names(sentence)) statements.push(sentence.trim());
  }
  return statements;
}

/**
 * What is wrong with a landing page for a search, in words its writer can
 * act on: the search belongs in its H1 and its first paragraph, and a number
 * beside the competitor's name must stand in a source or in the business's
 * own facts.
 */
export function landingPageProblems(input: {
  keyword: string;
  draft: string;
  competitor: string;
  /** The competitor's own words the page cites. */
  quotes: readonly string[];
  /** What the business says about itself: its Brand Brain, as text. */
  ownFacts: string;
}): string[] {
  const { heading, firstParagraph } = pageOpening(input.draft);
  const search = flat(input.keyword);
  const problems: string[] = [];
  if (heading === null)
    problems.push(
      'The page starts with its H1: the first line is "# " and the heading.',
    );
  else if (!flat(heading).includes(search))
    problems.push(
      `The H1 "${heading}" does not hold the search "${input.keyword}" word for word.`,
    );
  if (!firstParagraph || !flat(firstParagraph).includes(search))
    problems.push(
      `The first paragraph does not hold the search "${input.keyword}" word for word.`,
    );
  if (SOKOSUMI.test(input.draft)) problems.push("The page names Sokosumi.");
  const statements = competitorStatements(input.draft, input.competitor);
  if (statements.length > COMPETITOR_SENTENCES_MAX)
    problems.push(
      `The page speaks about ${input.competitor} in ${statements.length} sentences; keep it to ${COMPETITOR_SENTENCES_MAX} and say more about the business itself.`,
    );
  for (const statement of statements) {
    const invented = unsupportedNumbers(withoutDates(statement), [
      ...input.quotes,
      input.ownFacts,
      input.keyword,
    ]);
    if (invented.length > 0)
      problems.push(
        `"${statement}" has a number no source gives (${invented.join(", ")}). Quote the source that says it, or leave it out.`,
      );
  }
  return problems;
}

/**
 * Jev reads each thing the page says about the competitor against the
 * competitor's own words it cites. A statement they do not back is refused,
 * and one Jev left unanswered too, so nothing unchecked reaches the owner.
 * Throws when Jev fails.
 */
export async function unsupportedCompetitorClaims(input: {
  draft: string;
  competitor: string;
  quotes: readonly string[];
}): Promise<{ problems: string[]; costUsd: number }> {
  const statements = competitorStatements(input.draft, input.competitor).slice(
    0,
    COMPETITOR_SENTENCES_MAX,
  );
  if (statements.length === 0) return { problems: [], costUsd: 0 };
  const keyed = statements.map((statement, index) => ({
    key: `s${index + 1}`,
    statement,
  }));
  const { answers, costUsd } = await evaluateWithJev({
    state: {
      competitor: input.competitor,
      sources: input.quotes,
      statements: keyed,
    },
    questions: Object.fromEntries(
      keyed.map(({ key }) => [
        key,
        {
          type: "boolean" as const,
          instructions: `Statement ${key} is from a web page of another business. True when everything it says about ${input.competitor} (its product, price, plans, limits, quality, customers or company) is said in the sources, which are ${input.competitor}'s own words. Also true when it says nothing about ${input.competitor} itself: it only names it, asks a question, or speaks about the other business. False when it says anything about ${input.competitor} the sources do not say.`,
        },
      ]),
    ),
    timeoutMs: JEV_TIMEOUT_MS,
  });
  return {
    costUsd,
    problems: keyed.flatMap(({ key, statement }) => {
      const answer = answers.get(key);
      if (answer?.type !== "boolean")
        return [`"${statement}" could not be checked just now. Save it again.`];
      return answer.probability < MIN_SUPPORT
        ? [
            `"${statement}" says something about ${input.competitor} that no cited source says. Cite its own words for it, or leave it out.`,
          ]
        : [];
    }),
  };
}
