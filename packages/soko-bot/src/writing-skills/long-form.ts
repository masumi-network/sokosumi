import type { WritingSkill } from "./types.js";

export const LONG_FORM_WRITING_SKILLS: readonly WritingSkill[] = [
  {
    id: "newsletter",
    group: "long_form",
    name: "Newsletter",
    description:
      "Read before any newsletter issue: a subject line people open, one idea, one link to click.",
    channels: ["newsletter"],
    content: `# Newsletter

A newsletter goes to people who asked for it. They give it a few seconds in the inbox and, if it opens, a minute of reading. It is saved as a Markdown file the owner pastes into their email tool.

## The file

\`\`\`
Subject: [the subject line]
Preview: [the preview text]

[The email, in Markdown]
\`\`\`

## Subject line and preview

- **Subject**: 30 to 50 characters. Say what is inside, specifically ("The 3 breads we're dropping, and why"). No "Newsletter #12", no "Monthly update".
- **Preview**: 40 to 90 characters that add to the subject, never repeat it.
- No ALL CAPS, no "Re:" or "Fwd:" tricks, at most one emoji and only when the voice uses them.

## The email

- **One idea** per issue. Everything else is a short "Also" at the end, at most two lines.
- **Open with the point** in the first two sentences, written to one reader ("you").
- **Short paragraphs**: two to four sentences, a blank line between them.
- **Subheadings** (\`##\`) only when the email is longer than about 300 words.
- **One main link**, written as a plain Markdown link on words that say where it goes ("[Book a tasting](https://...)"), never "click here". Repeat it once at the end at most.
- **Length**: 150 to 300 words for a tip, up to 500 for a story.
- **Sign off** the way the owner would: their name, or the team when that is how they write.

## Example shape

A made-up bakery, structure only:

\`\`\`
Subject: We're baking 12 breads, not 40
Preview: The six you buy most stay. Here is what goes.

Hi,

From next Monday our shelf gets shorter. We looked at a year of sales, and six breads made most of them.

So we are keeping those six, adding six seasonal ones, and dropping the rest.

## What stays
- Country sourdough
- Rye with seeds
- ...

If your favourite is going, reply to this email. If enough of you ask, it stays.

[See the new shelf](https://...)

Anna, from the bakery
\`\`\`

## Never

- A newsletter that is a list of links with no story
- More than one call to action
- Words or claims the Brand Brain does not hold`,
    checklist: [
      { rule: "The subject line says specifically what is inside." },
      { rule: "The preview text adds to the subject and does not repeat it." },
      {
        rule: "One idea, opened in the first two sentences, written to one reader.",
      },
      {
        rule: "Short paragraphs and one main link on words that say where it goes.",
      },
      { rule: "It signs off the way the owner would, by name or as the team." },
      {
        rule: "A Subject of 30 to 50 characters and a Preview line; 150 to 500 words.",
        counted: true,
      },
    ],
  },
  {
    id: "seo",
    group: "long_form",
    name: "Search (SEO)",
    description:
      "Read before any article or page fix: answer the search first, titles and descriptions that fit Google's limits.",
    channels: ["seo"],
    content: `# Search (SEO)

People search with a question or a task. A page ranks and gets clicked when its title matches the search, its description promises the answer, and the page gives the answer quickly and completely. Every piece is a Markdown file the owner pastes into their site.

## Page fix

The file gives each field, ready to paste:

\`\`\`
Page: [the page's URL]
Now: [the page's current title, as the Brand Brain or Search Console shows it, or "not read"]
Baseline: [Search Console for the page's main search, last 28 days: clicks, impressions, position; or "not connected"]
Title: [at most 60 characters]
Description: [120 to 155 characters]
Heading (H1): [the page's main heading]
Why: [one line on what changes and why]
\`\`\`

- **Title**: at most 60 characters, the main search words first, the brand at the end after a separator ("Sourdough Bread Delivery in Zurich | Northside Bakery"). Patterns by page type: a product or service page "[What it is] for [who or where] | Brand"; a category "[Products] in [place or kind] | Brand"; an article "[The question or task]: [the answer's promise]"; a comparison "[Brand] vs [Rival]: [the difference that matters]".
- **Baseline** is what the change is judged against in four weeks; never change the same page again sooner.
- **Description**: 120 to 155 characters, the answer or benefit plus one reason to click. Never a list of keywords.
- **Heading**: says what the page is about in the searcher's words; it can be longer than the title.

## Article

- **Pick one search** the article answers (from the strategy and the Brand Brain), and use its words in the title, the first paragraph and one subheading. Before writing, say in one sentence what it adds that the pages already ranking do not; if nothing, choose another angle.
- **Structure**:
  - \`# Title\` (a heading, at most about 60 characters)
  - The answer in the first paragraph, two to three sentences. Do not make people scroll for it.
  - \`##\` sections for each part of the answer, phrased the way people ask ("How long does sourdough keep?"). Open each with the answer in 40 to 60 words that make sense alone: search and AI answer tools quote those.
  - Short paragraphs, lists for steps and options, a table when comparing (a comparison page always has one: price, who it is for, the main difference).
  - An FAQ section of three to five short questions people ask, when the search has them.
  - A closing section with the next step and one link to the offer.
- **Length**: as long as the answer needs, usually 800 to 1,500 words. No filler introductions or history lessons.
- **Proof**: real details from the Brand Brain (prices, processes, examples) and a real source for every number, never invented statistics.
- **Links**: plain Markdown links on descriptive words; link to the brand's own pages where they help.
- Add a **meta description** line at the top of the file (Description: ...), 120 to 155 characters.
- End the file with a **Link from:** block: two or three of the owner's existing pages that should link to this article, each with the words to link on ("Link from: /pricing, on 'how long bread keeps'"). A new page nobody links to is hard to find.
- A comparison page ("X vs Y", "X alternative") is fair: the rival's published prices and features, what its reviewers praise and complain about, and when the rival is the better choice. Never a claim about the rival you cannot link to.

## Example shape

\`\`\`
Description: How long sourdough keeps, how to store it so the crust stays crisp, and how to freeze and revive a loaf.

# How Long Does Sourdough Bread Keep?

Sourdough keeps three to four days at room temperature in a paper bag, longer than most bread because of its acidity. Frozen, it keeps for three months.

## How to store sourdough
...
\`\`\`

## Never

- Keyword stuffing or the same phrase in every sentence
- Generic AI introductions ("In today's world, bread is...")
- An article that never answers its own title`,
    checklist: [
      {
        rule: "Page fix: the title leads with the words people search for, and the description promises the answer.",
        formats: ["page_fix"],
      },
      {
        rule: "Page fix: the heading says what the page is about in the searcher's words.",
        formats: ["page_fix"],
      },
      {
        rule: "Article: the first paragraph answers the search, then ## sections phrased like the questions people ask.",
        formats: ["article"],
      },
      {
        rule: "Article: short paragraphs, lists or tables where they help, no filler introduction.",
        formats: ["article"],
      },
      {
        rule: "Article: each ## section opens with a short answer that makes sense on its own.",
        formats: ["article"],
      },
      {
        rule: "Page fix: a Now line with the current title and a Baseline line, then the new fields.",
        formats: ["page_fix"],
      },
      { rule: "No keyword stuffing and no invented statistics." },
      {
        rule: "Page fix: a Title of at most 60 characters and a Description of 120 to 155. Article: a Description line of 120 to 155 characters, then a # title, and a Link from: line.",
        counted: true,
      },
    ],
  },
];
