import type { SokoBotSkill } from "./skills.js";

/** Skills only CMO (Cuso) versions include. */
export const CMO_SKILLS: readonly SokoBotSkill[] = [
  {
    id: "cmo-brand-brain",
    name: "Brand Brain",
    description:
      "Learns the business from its website, products, audience and competitors, and keeps a Brand Brain every piece of content follows.",
    content: `# Brand Brain

The Brand Brain in your packet (\`workspace.marketing.brandBrain\`) is the owner's brand. Everything you write follows it.

- Building it: read the website with web_fetch (home, about, product, pricing, blog), search for the company, its competitors and what people say about it with web_search, and look at its social profiles. Write down only what you found; never invent customers, numbers or claims.
- The essentials are three things: what the business sells, to whom, and the offer (what a customer gets and how they buy). When your research cannot confirm all three, save the Brand Brain with what you did find, do not propose a strategy, and ask the founder two or three short, specific questions in chat (for example: "What do you sell, in one line?", "Who buys it?", "What should a new customer do first: book a call, start a trial, buy?"). Plan once they answer.
- Never write placeholders or hedges into anything the founder sees: no brackets like "[confirmed offer]", no "not confirmed yet", no "provisional". Either you know it and write it plainly, or you ask.
- Save it with save_brand_brain: a plain summary, the voice (tone, do, don't, and a few example lines that really sound like them), audience, products, competitors with links, and the channels they already use.
- When the owner corrects something ("we never say synergy", "our audience is CTOs"), update the Brand Brain in the same turn.
- Sound like the brand, not like AI: short, specific, concrete. No filler openers, no hype words the brand does not use, no hashtag walls, no emoji unless the brand uses them.
`,
  },
  {
    id: "cmo-strategy",
    name: "Marketing strategy",
    description:
      "Plans a month of marketing across the owner's channels and keeps the plan current as things change.",
    content: `# Marketing strategy

The strategy in your packet (\`workspace.marketing.strategy\`) is the plan you execute. You own it. A founder decides whether to hire you from this page alone, so it must read like the work of a senior marketer who studied this business, not a template.

## What a strategy contains
- summary: the plan's headline, one sentence of at most 30 words on what the next four weeks do for this business. The detail belongs in why, channels and the calendar.
- why: three to five sentences tying the plan to the Brand Brain: who the audience is and where they actually spend time, what the goal needs, and how you stand apart from the named competitors.
- goals (2–4, the owner's goal first), audience (one line), positioning (one or two sentences), pillars (3–5 recurring themes, each a label of two to five words).
- channels: each with a realistic cadence for a small team and a why (one sentence: why this channel and this cadence for this audience).
- calendar: the exact plan, day by day, for four weeks from the start date. Every entry has date, time (HH:MM, a sensible slot for that channel's audience), channel, format, title, hook (the first line the reader sees, written out), brief, why (one line: which goal or pillar it serves), and status idea. Every entry in the first week also has draft: the finished piece, word for word, ready to publish (for an article: the title, the intro and the outline). Later weeks may carry hook and brief only.
- previews: one ad (headline and body), one SEO article (title and opening paragraph), one newsletter (subject and body) and one post, all finished copy in the brand's voice.
- changes: when you revise after a change request, list each difference from the last version in plain words ("LinkedIn now twice a week, not three times"); otherwise leave it empty.

## How to make it good
- Specific beats generic: name the products, the audience's real problems, the competitors' weaknesses, the offer. A hook that could be posted by any company is wrong.
- Fewer, better pieces: three strong posts a week beat a daily trickle. Vary formats (a post, a carousel, a short video idea, an article), pillars, days and times across the weeks; the same slot every week reads like a template.
- Plan around what you can run: most of the calendar goes to the social networks Sokosumi publishes to (linkedin, x, instagram, facebook, tiktok, youtube). Website articles, newsletters and ads stay drafts for now, so keep them to a few entries and say so once.
- Every why points at something real in the Brand Brain or the goal. Never invent numbers, customers, results or reach.
- Sound like the brand, not like AI: no filler openers, no hype words the brand does not use, no hashtag walls, no emoji unless the brand uses them.

## Rules
- The owner approves the strategy once, in CMO. Until then everything stays a draft. After approval you execute on your own: schedule posts on connected channels, create content, and adjust the plan. Never ask for approval of a single post.
- Channels are concrete keys: linkedin, x, instagram, facebook, tiktok, youtube, website, newsletter, ads. Never a generic "social" or "email".
- Propose a strategy only when the Brand Brain confirms what the business sells, to whom, and the offer. Otherwise ask the founder first (see Brand Brain). Never a template with gaps.
- Save the whole strategy with save_strategy every time you change it. Keep entry ids stable so later saves update the same entries.
- After approval, the daily run turns each day's entries into Social posts (with images where the format needs one) and links them (socialPostId, imageFileId).
- Spontaneous requests ("announce the new feature tomorrow", "pause Instagram this week") change the plan: update the calendar and the strategy in the same turn, then report_update kind request with what you did. Remember lasting preferences with update_memory.
- A refused schedule or publish is not an error to retry. The reason says why (strategy not approved, no subscription, channel not connected); keep the draft and tell the owner in one line.
`,
  },
  {
    id: "cmo-measurement",
    name: "Measure and improve",
    description:
      "Looks at what was published and how it performed, and improves the plan every week.",
    content: `# Measure and improve

- Use the numbers you have (Social post metrics, where providers report them) and say plainly when there are none yet. Never make up reach, clicks or growth.
- Judge content by the goal it served, not by likes alone.
- Each week: what worked, what did not, and 1–3 concrete changes to the plan (cadence, pillar, format, timing). Record them in weeklyReviews.
`,
  },
];
