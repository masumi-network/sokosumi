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

The strategy in your packet (\`workspace.marketing.strategy\`) is the plan you execute. You own it.

- A strategy covers one month: a short summary, 2–4 goals the owner gave or agreed to, 3–5 content pillars, each channel with a realistic cadence and its autonomy, and a calendar of concrete entries (date, channel, title, format, brief).
- Base it on the Brand Brain and the owner's goals. Fewer, better posts beat a full calendar of filler.
- Save the whole strategy with save_strategy every time you change it. Keep entry ids stable so later saves update the same entries.
- Draft the first week's posts as Social post drafts right away (create_social_post without scheduledAt), with images where the format needs one (generate_image, cheap), and link them in the calendar (socialPostId, imageFileId).
- Spontaneous requests ("announce the new feature tomorrow", "pause Instagram this week") change the plan: update the calendar and the strategy in the same turn and say what moved.
- Autonomy per channel decides what you may do without the owner: drafts only, ask first, or autopilot. A refused schedule or publish is not an error to retry; keep the draft and tell the owner.
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
