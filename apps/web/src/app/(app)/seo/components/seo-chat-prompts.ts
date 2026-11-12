const SEO_AGENT_PROMPTS = [
  "first",
  "unranked",
  "queries",
  "track",
  "competitors",
] as const;

/** Questions that follow on from a starter question. Each needs the data its starter needed. */
const SEO_FOLLOW_UPS = {
  first: ["howToDo", "whyFirst"],
  unranked: ["whichPage", "howLong"],
  queries: ["moreClicks"],
  track: ["whyKeywords"],
  competitors: ["theyDo"],
} as const;

/** The follow-up to a question the reader typed: any answer can be put in plainer words. */
const SEO_TYPED_FOLLOW_UP = "simpler";

/** The chat shows this many suggestions at most, so they stay one quiet row. */
export const SEO_CHAT_SUGGESTION_LIMIT = 3;

type SeoStarter = (typeof SEO_AGENT_PROMPTS)[number];
export type SeoChatPrompt =
  | SeoStarter
  | (typeof SEO_FOLLOW_UPS)[SeoStarter][number]
  | typeof SEO_TYPED_FOLLOW_UP;

const SEO_CHAT_PROMPTS: readonly SeoChatPrompt[] = [
  ...SEO_AGENT_PROMPTS,
  ...Object.values(SEO_FOLLOW_UPS).flat(),
  SEO_TYPED_FOLLOW_UP,
];

type SeoChatData = {
  /** True where no checked keyword is in Google's top results: the question about that result stands in for "what first", which the Agent tab answers. */
  unranked: boolean;
  /** False where the Audit has no competitor. */
  competitors: boolean;
  /** False where no search statistics are synced: the question about keywords to track stands in. */
  searches: boolean;
};

/** The example questions the saved data can answer: no search statistics, no question about searches. */
export function seoAgentPrompts({
  competitors,
  searches,
  unranked,
}: SeoChatData): SeoStarter[] {
  return SEO_AGENT_PROMPTS.filter(
    (prompt) =>
      (competitors || prompt !== "competitors") &&
      prompt !== (searches ? "track" : "queries") &&
      prompt !== (unranked ? "first" : "unranked"),
  );
}

/**
 * The suggestions under the thread: the follow-ups to the newest question
 * first, then the starters not asked yet. A question asked once is not
 * offered again.
 */
export function seoChatSuggestions({
  asked,
  textOf,
  ...data
}: SeoChatData & {
  /** The thread's questions, oldest first. */
  asked: readonly string[];
  /** The text the reader sees and sends for a suggestion. */
  textOf: (prompt: SeoChatPrompt) => string;
}): SeoChatPrompt[] {
  // Matched by the text in the viewer's language: a question asked in another
  // language, or before a copy change, counts as a typed question.
  const keyOf = (question: string) =>
    SEO_CHAT_PROMPTS.find((prompt) => textOf(prompt) === question.trim());
  const done = new Set(asked.map(keyOf));
  const newest = asked.at(-1);
  const newestKey = newest === undefined ? undefined : keyOf(newest);
  // A follow-up keeps its starter's other follow-ups on offer.
  const starter = (Object.keys(SEO_FOLLOW_UPS) as SeoStarter[]).find(
    (key) =>
      key === newestKey ||
      (SEO_FOLLOW_UPS[key] as readonly SeoChatPrompt[]).includes(
        newestKey as SeoChatPrompt,
      ),
  );
  const followUps: readonly SeoChatPrompt[] =
    newest === undefined
      ? []
      : newestKey === undefined
        ? [SEO_TYPED_FOLLOW_UP]
        : starter
          ? SEO_FOLLOW_UPS[starter]
          : [];
  return [...new Set([...followUps, ...seoAgentPrompts(data)])]
    .filter((prompt) => !done.has(prompt))
    .slice(0, SEO_CHAT_SUGGESTION_LIMIT);
}
