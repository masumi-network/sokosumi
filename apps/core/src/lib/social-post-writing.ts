import type { SocialPostProvider } from "@sokosumi/utils";

const SOUNDS_HUMAN =
  "Sound like a person, not a press release: no em dashes, no 'game-changer', 'unlock', 'elevate', 'seamless' or 'in today's fast-paced world', no row of emoji.";
const PLAIN_TEXT =
  "Plain text only: Markdown does not render, so **bold**, # headings, [label](url) links and `code` show up as raw symbols.";

/**
 * How a good post reads on each network, for the bot to read before it
 * drafts. Kept to what platform guides agree on; numbers that sources
 * dispute are left out.
 */
export const SOCIAL_POST_WRITING_GUIDES = {
  x: [
    "The first line is the post: lead with the point, a claim or a question, not a preamble. Name the topic in the first ten words; X shows posts to people who follow that topic.",
    "Short and concrete. One idea per post; use a thread (threadParts) only when each part adds something.",
    "Put links in firstComment (a reply), not the post: posts with links get less reach.",
    "At most 2 hashtags, only when they name a topic people follow; often none.",
    "Write to start replies: ask, take a position, or invite a take. Native images or video beat a link preview.",
    "Space posts by about an hour: posts close together compete with each other. Never bait for reactions; people muting a post costs reach.",
    SOUNDS_HUMAN,
    PLAIN_TEXT,
  ],
  linkedin: [
    "The first one or two lines show before 'see more' (about 140 characters on mobile): make them the hook.",
    "Short paragraphs of one or two sentences with a blank line between them; a list of plain '-' lines is fine.",
    "Speak from experience: a lesson, a result, a decision and why. End with a question or a clear takeaway.",
    "1,200 to 1,500 characters reads best for a text post. A multi-image post (carousel) reaches well: one idea per image.",
    "Put links in firstComment, not the post: posts with links get less reach.",
    "3 to 5 specific hashtags at the end, never mid-sentence.",
    SOUNDS_HUMAN,
    PLAIN_TEXT,
  ],
  facebook: [
    "Short wins: the point in the first line or two, before 'See more'. 40 to 80 characters gets the most replies.",
    "Native video and photos reach far more people than links.",
    "Conversational, like talking to a neighbour; ask something people can answer in a comment.",
    "Put links in firstComment, not the post: link posts reach the fewest people.",
    "Hashtags add little here: at most 3, often none.",
    SOUNDS_HUMAN,
    PLAIN_TEXT,
  ],
  instagram: [
    "The caption supports the image or video; the first line (before 'more') must make people stop.",
    "Write the words people search for (topic, place, product) naturally into the first sentence: captions are searchable.",
    "Links are not clickable in captions: point to the link in bio instead of pasting a URL.",
    "3 to 5 specific hashtags at the end, never a wall of tags.",
    "Line breaks between short paragraphs; end with a question or a call to action.",
    "Carousels and reels reach furthest; portrait 4:5 images fill the feed. Make posts worth saving and sharing: that is what Instagram rewards.",
    SOUNDS_HUMAN,
    PLAIN_TEXT,
  ],
  tiktok: [
    "The video carries the post: the caption is one or two short lines with the keywords people search for.",
    "Add a hook or question that makes people watch to the end or comment.",
    "3 to 5 hashtags: a mix of the niche topic and one broader one.",
    "Links are not clickable in captions.",
    SOUNDS_HUMAN,
    PLAIN_TEXT,
  ],
  youtube: [
    "The title asks the viewer's question or names the task, in about 70 characters.",
    "The first one or two lines of the description show before 'Show more': say what the video is about, with its main keyword.",
    "Then a short summary, and links the viewer needs, each on its own line.",
    "For a long video, add chapters: one timestamp per line, the first at 0:00, at least three.",
    "3 to 5 relevant hashtags at the end; the first three show above the title.",
    SOUNDS_HUMAN,
    PLAIN_TEXT,
  ],
} as const satisfies Record<SocialPostProvider, readonly string[]>;

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
