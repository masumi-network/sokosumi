import type { WritingSkill } from "./types.js";

const EVERY_CHANNEL = [
  "linkedin",
  "x",
  "facebook",
  "instagram",
  "youtube",
  "tiktok",
  "meta_ads",
  "google_ads",
  "newsletter",
  "seo",
] as const;

export const FOUNDATION_WRITING_SKILLS: readonly WritingSkill[] = [
  {
    id: "brand-voice",
    group: "foundations",
    name: "Brand voice",
    description:
      "Read before every piece: how the Brand Brain's voice and a network's skill work together.",
    channels: EVERY_CHANNEL,
    content: `# Brand voice

Every piece has two teachers. The network's skill decides the shape: where the hook goes, how long it runs, where the link sits. The brand's voice decides the words: how formal, how warm, how funny, which words they use and which they never would. When the two pull apart, keep the network's shape and the brand's words.

The voice is in the Brand Brain (\`brandBrain.voice\`):

- **tone**: three words and at most one sentence. Hold every line against them.
- **do** and **dont**: rules the owner agreed to. A don't is never broken, even when a network skill suggests it (a brand that says "no emoji" gets none on Instagram either).
- **examples**: real lines from their site or posts. These are the best guide you have. Match their sentence length, their warmth, their words for things.

## How to sound like them

- Use their words for their product and their customers. If they say "clients", never write "customers"; if they say "the app", never "our platform".
- Match their sentence length. A brand that writes in short punchy lines gets short punchy lines on LinkedIn too.
- Match their person. "We" brands stay "we"; a founder who writes as "I" stays "I".
- Keep their level of formality in every language. Use the formal or informal "you" the way their site does.
- Facts only from the Brand Brain: a price as the offers list it, a result only when it is in their proof. Never invent a number, a customer or a quote.

## The examples in the network skills

The network skills show example posts for other, made-up businesses. They show structure only: how long, where the line breaks go, how the hook and the ending work. Never copy their tone, their jokes or their phrases into this brand's posts.

## A piece is in the voice when

- the owner could post it without changing a word;
- a regular reader would know who wrote it without the logo;
- it says something only this business could say, not something every business in the category could.`,
    checklist: [
      {
        rule: "It sounds like the brand's voice examples: the same tone, sentence length and words for things.",
        voice: true,
      },
      { rule: "It breaks none of the voice's don't rules.", voice: true },
      {
        rule: "It states no number, price, customer or quote that the brand facts do not hold.",
      },
      {
        rule: "It names at least one thing only this business has: its product, plan or feature by name, its price, its place, a customer or a number of its own.",
      },
    ],
  },
  {
    id: "post-formatting",
    group: "foundations",
    name: "Post formatting",
    description:
      "Read before any social post or ad: how plain text looks on a phone, and how to lay it out.",
    channels: [
      "linkedin",
      "x",
      "facebook",
      "instagram",
      "youtube",
      "tiktok",
      "meta_ads",
    ],
    content: `# Post formatting

Social posts and ads are plain text, read on a phone, in a feed full of other posts. The layout is half of whether anyone reads them.

## Plain text only

Markdown does not render on any network. \`**bold**\`, \`# headings\`, \`[label](url)\` links and \`code\` show up as raw symbols. Never use fake bold or italic letters (𝗯𝗼𝗹𝗱, 𝘪𝘵𝘢𝘭𝘪𝘤) either: screen readers spell them out letter by letter and search cannot find them.

## Lines and paragraphs

- One idea per paragraph, one or two sentences long.
- A blank line between paragraphs. On a phone, a paragraph of more than three lines looks like a wall and people scroll past it.
- The first line stands alone. Never put the hook and the second thought in the same paragraph.
- Short lines are fine; single words on their own line are not a style, they are noise.

## Lists

A list is plain lines that start with "-" or a number and a full stop ("1."), one item per line, with no blank lines between items. Three to five items. Each item is short enough to read at a glance.

Use a list when the content is a list (steps, reasons, options). Never turn a story into bullet points.

## Emoji

Follow the voice. When the brand uses emoji, at most one or two per post, where they add meaning (a ✅ beside done steps), never one at the start of every line and never a row of them. When the voice says nothing, use none on LinkedIn and X, and at most one on Instagram and Facebook.

## Hashtags

At the very end, on their own line, never inside a sentence. Each network's skill says how many. A tag names a topic people follow (#bookkeeping), never a slogan (#BestBakeryEver).

## Links

Each network's skill says where the link goes. Most networks show posts with a link in the body to fewer people, so the link goes in firstComment and the post says where to find it ("Link in the first comment.").

## Example layout

A made-up bookkeeping app, showing the shape only:

\`\`\`
Most freelancers lose two days a year to receipts.

We timed it with 40 of our users. The slow part is never the typing. It is finding the receipt.

Three things that fixed it for them:
- Snap the receipt the moment you pay
- One folder per month, nothing else
- Match them to the bank feed every Friday

Which one would you start with?
\`\`\``,
    checklist: [
      {
        rule: "Plain text: no Markdown symbols and no fake bold or italic letters.",
        counted: true,
      },
      {
        rule: "Short paragraphs of one or two sentences with a blank line between them; no paragraph longer than three phone lines.",
      },
      { rule: "The first line stands on its own." },
      {
        rule: "Lists are plain '-' or numbered lines, three to five items, only where the content is a list.",
      },
      { rule: "Hashtags, if any, sit on their own line at the end." },
    ],
  },
  {
    id: "hooks-and-endings",
    group: "foundations",
    name: "Hooks and endings",
    description:
      "Read before any social post or ad: how to open so people stop, and how to close so they act.",
    // A newsletter's subject, opening and one link, a search piece's fields
    // and a Google ad's headlines and descriptions are shaped by their own skills.
    channels: EVERY_CHANNEL.filter(
      (channel) =>
        channel !== "seo" &&
        channel !== "newsletter" &&
        channel !== "google_ads",
    ),
    content: `# Hooks and endings

People decide in the first line whether to read on. Most feeds show only that line, or two, before "see more". The ending decides whether they do anything.

## The first line

Lead with the point. The first line is the reason to read, not a warm-up.

Openings that work:

- **A specific claim**: "Our slowest month made us the most money."
- **A number with meaning**: "We answered 1,200 support emails last year. 300 asked the same question."
- **A question the reader has**: "How much should a first website cost?"
- **A small story, mid-scene**: "The customer walked in with a cake drawn on a napkin."
- **A mistake or a reversal**: "We stopped offering free delivery. Orders went up."

Openings that lose people:

- A preamble: "In today's world...", "I've been thinking a lot about...", "Exciting news!"
- A label instead of a point: "Monday tip:", "Thread:", "New blog post:"
- Questions nobody asks ("Ever wondered about the history of invoicing?")
- Bait: "You won't believe...", "Nobody talks about this...", "Stop scrolling."

Name the topic in the first ten words: X, LinkedIn and Instagram show posts to people who follow that topic, and search reads the opening first.

## The middle

Deliver what the hook promised, quickly. One idea, the detail that makes it believable (a number, a name, a moment), and nothing else. Cut every sentence that the post works without.

## The ending

End with one thing for the reader to do or think:

- a question they can answer from their own experience ("What did your first client pay you?");
- a clear takeaway in one line;
- one plain call to action for the funnel stage: follow, save, reply, visit, book. Name the action and what they get ("Book a tasting in the link in the first comment.").

Never end on "Agree?", "Thoughts?" or "Let me know in the comments!": those are bait, and networks show bait to fewer people. Never stack several calls to action.

## Before you save

Read only the first line. Would a stranger in the right audience stop for it? If not, rewrite it before anything else.`,
    checklist: [
      {
        rule: "The first line leads with the point (a claim, a number, a real question or a moment), with no preamble or label.",
      },
      {
        rule: "No bait ('You won't believe', 'Agree?', 'Thoughts?').",
        counted: true,
      },
      {
        rule: "It ends with a single question, takeaway or call to action.",
      },
    ],
  },
];
