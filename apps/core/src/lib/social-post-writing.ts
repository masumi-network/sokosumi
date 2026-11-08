import { writingSkillsForChannels } from "@sokosumi/soko-bot";
import {
  SOCIAL_POST_TEXT_LIMITS,
  type SocialPostProvider,
} from "@sokosumi/utils";

const SOUNDS_HUMAN =
  "Sound like a person, not a press release: no em dashes, no 'game-changer', 'unlock', 'elevate', 'seamless' or 'in today's fast-paced world', no row of emoji.";

function writingGuide(provider: SocialPostProvider): readonly string[] {
  // The brand voice lives in CMO's Brand Brain, which other bots do not have.
  const skills = writingSkillsForChannels([provider]).filter(
    (skill) => skill.id !== "brand-voice",
  );
  return [
    ...skills.flatMap((skill) => skill.checklist.map((rule) => rule.rule)),
    SOUNDS_HUMAN,
  ];
}

/**
 * How a good post reads on each network, for the bot to read before it
 * drafts: the checklists of the writing skills, which CMO's evaluator also
 * holds each made piece to.
 */
export const SOCIAL_POST_WRITING_GUIDES = Object.fromEntries(
  (Object.keys(SOCIAL_POST_TEXT_LIMITS) as SocialPostProvider[]).map(
    (provider) => [provider, writingGuide(provider)],
  ),
) as Record<SocialPostProvider, readonly string[]>;

const MAX_HASHTAGS = {
  x: 2,
  linkedin: 5,
  facebook: 3,
  instagram: 5,
  tiktok: 5,
  youtube: 5,
} as const satisfies Record<SocialPostProvider, number>;

const MARKDOWN: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /\*\*[^*\n]+\*\*|__[^_\n]+__/, label: "**bold**" },
  { pattern: /^#{1,6}\s/m, label: "# headings" },
  {
    pattern: /\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)/,
    label: "[label](url) links",
  },
  { pattern: /`[^`\n]+`/, label: "`code`" },
];

/** Lines that make a post read like AI or an ad, with what to tell the bot. */
const BANNED_COPY: readonly { pattern: RegExp; problem: string }[] = [
  {
    pattern: /\bit'?s not [^.,;]{1,40}, it'?s\b/i,
    problem: "uses \"it's not X, it's Y\"",
  },
  {
    pattern:
      /\b(game[- ]changer|unlock|elevate|seamless|say goodbye to|reimagined|in today's fast-paced world)\b/i,
    problem:
      "uses a stock phrase (game-changer, unlock, elevate, seamless, say goodbye to, reimagined)",
  },
  {
    pattern: /\b(agree|thoughts)\?\s*$/im,
    problem: 'ends on engagement bait ("Agree?", "Thoughts?")',
  },
  { pattern: /—/, problem: "has an em dash" },
  {
    pattern:
      /\b(check|read|compare|see)\b[^.!?\n]{0,50}\b(product page|details|product details|product information)\b/i,
    problem:
      "tells people to check the details instead of giving one: name the product, its price or a real detail of the business",
  },
  {
    pattern: /\b(vary|varies) by (style|product|item|region|size)\b/i,
    problem:
      'hedges ("varies by style"): say what is true for the product in the post, or leave it out',
  },
];

/** What a text breaks of the copy rules every bot's writing guide states. */
export function bannedCopyProblems(text: string): string[] {
  return BANNED_COPY.filter(({ pattern }) => pattern.test(text)).map(
    ({ problem }) => problem,
  );
}

const FILLER_WORDS = new Set(
  "a an and are as at be before but by can for from has have how in into is it its just not of on one only or our than that the their them then they this to two was what when where which who will with you your".split(
    " ",
  ),
);
/** Words a post must hold, beyond its month's everyday ones, before it can repeat another. */
const MIN_DISTINCT_WORDS = 4;
/** Share of their words two posts may have in common; a cutoff from a month that repeated four messages 45 times. */
const MAX_SHARED_WORDS = 0.35;
/** A word in more of a month's posts than this is its everyday vocabulary (the brand, the product). */
const EVERYDAY_SHARE = 0.3;
/** Fewer posts than this have no everyday vocabulary to leave out. */
const MIN_POSTS_FOR_EVERYDAY = 8;

function contentWords(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
      (word) => word.length > 2 && !FILLER_WORDS.has(word),
    ),
  );
}

/**
 * The post a text nearly repeats among the month's others, or null. Words
 * every post shares (the brand, its product) are left out first, so two
 * posts about different customers of the same product stay apart.
 */
export function nearDuplicatePost<T extends { text: string }>(
  text: string,
  others: readonly T[],
): T | null {
  const sets = others.map((other) => contentWords(other.text));
  const own = contentWords(text);
  const everyday = new Set<string>();
  if (others.length + 1 >= MIN_POSTS_FOR_EVERYDAY) {
    const counts = new Map<string, number>();
    for (const set of [own, ...sets])
      for (const word of set) counts.set(word, (counts.get(word) ?? 0) + 1);
    for (const [word, count] of counts)
      if (count > (others.length + 1) * EVERYDAY_SHARE) everyday.add(word);
  }
  const distinct = (set: Set<string>) =>
    new Set([...set].filter((word) => !everyday.has(word)));
  const mine = distinct(own);
  if (mine.size < MIN_DISTINCT_WORDS) return null;
  let closest: { other: T; shared: number } | null = null;
  others.forEach((other, index) => {
    const theirs = distinct(sets[index] ?? new Set());
    if (theirs.size < MIN_DISTINCT_WORDS) return;
    const common = [...mine].filter((word) => theirs.has(word)).length;
    const shared = common / (mine.size + theirs.size - common);
    if (shared >= MAX_SHARED_WORDS && shared > (closest?.shared ?? 0))
      closest = { other, shared };
  });
  return (closest as { other: T } | null)?.other ?? null;
}

/** Bold or italic look-alike letters: screen readers spell them, search misses them. */
const FAKE_STYLED_LETTERS = /[\u{1D400}-\u{1D7FF}]/u;
/** A paragraph longer than this is a wall of text on a phone. */
const MAX_PARAGRAPH_CHARS = 400;
/** Networks read as paragraphs, where a wall of text loses people. */
const PARAGRAPH_NETWORKS = new Set<SocialPostProvider>([
  "linkedin",
  "facebook",
  "instagram",
]);

/** The opening words of the first paragraph too long to read on a phone. */
function wallOfText(text: string): string | null {
  const wall = text
    .split(/\n\s*\n/)
    .find((paragraph) => paragraph.trim().length > MAX_PARAGRAPH_CHARS);
  return wall ? wall.trim().split(/\s+/).slice(0, 6).join(" ") : null;
}

const HASHTAG = /(?:^|\s)#[\p{L}\p{N}_]+/gu;
const URL = /https?:\/\/\S+/i;
/** Networks whose captions do not make a URL clickable. */
const UNCLICKABLE_LINKS = new Set<SocialPostProvider>(["instagram", "tiktok"]);
/** Networks that show posts with a link to fewer people. */
const LINK_PENALTY = new Set<SocialPostProvider>(["x", "linkedin", "facebook"]);

/**
 * Mistakes that make a bot-written post look broken or reach fewer people,
 * as one message for the bot to fix and retry; null when the post is fine.
 */
export function socialPostFormattingError(
  provider: SocialPostProvider,
  post: {
    texts: readonly (string | null | undefined)[];
    /** The main post's own text, where a link costs reach. */
    body: string;
    firstComment: string | null;
    /** The owner asked for the link in the post itself. */
    linkInPost?: boolean;
  },
): string | null {
  const problems: string[] = [];
  const markdown = MARKDOWN.filter(({ pattern }) =>
    post.texts.some((text) => text && pattern.test(text)),
  ).map(({ label }) => label);
  if (markdown.length > 0)
    problems.push(
      `it uses Markdown (${markdown.join(", ")}), which ${provider} shows as raw symbols; write plain text`,
    );
  const copy = [
    ...new Set(post.texts.flatMap((text) => bannedCopyProblems(text ?? ""))),
  ];
  if (copy.length > 0) problems.push(`it ${copy.join("; it ")}`);
  if (post.texts.some((text) => text && FAKE_STYLED_LETTERS.test(text)))
    problems.push(
      "it uses fake bold or italic letters, which screen readers spell out and search cannot find; write plain letters",
    );
  const wall = PARAGRAPH_NETWORKS.has(provider) ? wallOfText(post.body) : null;
  if (wall)
    problems.push(
      `the paragraph starting "${wall}" is a wall of text on a phone; split it into paragraphs of one or two sentences with a blank line between them`,
    );
  const hashtags = Math.max(
    0,
    ...post.texts.map((text) => text?.match(HASHTAG)?.length ?? 0),
  );
  if (hashtags > MAX_HASHTAGS[provider])
    problems.push(
      `it has ${hashtags} hashtags; use at most ${MAX_HASHTAGS[provider]} on ${provider}`,
    );
  const linkProblem =
    !post.linkInPost &&
    URL.test(post.body) &&
    (UNCLICKABLE_LINKS.has(provider) || LINK_PENALTY.has(provider));
  if (linkProblem) {
    if (UNCLICKABLE_LINKS.has(provider))
      problems.push(
        `links are not clickable in ${provider} captions; point to the link in bio instead`,
      );
    else
      problems.push(
        `the link in the post body makes ${provider} show it to fewer people; move it to firstComment`,
      );
  }
  if (problems.length === 0) return null;
  return `Rewrite the post: ${problems.join("; ")}.${
    linkProblem
      ? " A link the owner gave you still goes in firstComment; pass linkInPost true only when they said in words to put it in the post itself."
      : ""
  }`;
}
