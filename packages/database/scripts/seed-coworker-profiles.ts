/**
 * @deprecated Use `pnpm prisma:seed` instead. This script only updates existing
 * coworker rows; the canonical seed creates full fixture data locally.
 *
 *   pnpm prisma:seed
 */
import { createPrismaClient } from "../src/client";

interface AgentSeed {
  description: string;
  llm: string[];
  hosting: string;
  capabilities: string[];
  examples: string[];
}

const SEED: Record<string, AgentSeed> = {
  elena: {
    description:
      "Your project lead. Elena turns a fuzzy goal into a clear, sequenced plan, delegates the right steps to the right specialists, and keeps everything moving to deadline so you always know what's happening and what's next.",
    llm: ["GPT-4o", "Claude 3.5 Sonnet"],
    hosting: "EU · Frankfurt",
    capabilities: ["Project Management", "Coordination", "Planning"],
    examples: [
      "Break a goal into a clear task plan",
      "Coordinate work across multiple agents",
      "Summarize current project status",
    ],
  },
  alex: {
    description:
      "A senior engineer in agent form. Alex writes and reviews production-grade code across Python and TypeScript, tracks down tricky bugs, and explains every change in plain language so the whole team stays in the loop.",
    llm: ["Claude 3.5 Sonnet", "GPT-4o"],
    hosting: "EU · Frankfurt",
    capabilities: ["Coding", "Debugging", "Code Review"],
    examples: [
      "Write a Python or TypeScript script",
      "Track down and fix a failing test",
      "Review a pull request for issues",
    ],
  },
  "coding-agent": {
    description:
      "An autonomous builder that scaffolds features end to end, wires up integrations, and refactors messy code — handling the repetitive engineering work so your team can focus on the hard, interesting parts.",
    llm: ["Claude 3.5 Sonnet"],
    hosting: "EU · Frankfurt",
    capabilities: ["Coding", "Automation", "Refactoring"],
    examples: [
      "Scaffold a new feature end-to-end",
      "Automate a repetitive workflow",
      "Refactor a messy module",
    ],
  },
  deckster: {
    description:
      "A presentation specialist that turns rough notes and raw data into a polished, on-brand deck — a clear narrative, clean slides, and speaker-ready structure in minutes instead of hours.",
    llm: ["GPT-4o"],
    hosting: "EU · Frankfurt",
    capabilities: ["Presentations", "Slide Design", "Storytelling"],
    examples: [
      "Build a pitch deck from a brief",
      "Turn rough notes into slides",
      "Design a clean summary slide",
    ],
  },
  demos: {
    description:
      "A rapid prototyper for spinning up demo flows and proof-of-concepts fast, so you can show an idea in action instead of describing it in a document.",
    llm: ["GPT-4o mini"],
    hosting: "US · Virginia",
    capabilities: ["Demos", "Prototyping"],
    examples: ["Spin up a quick demo flow", "Prototype a product idea"],
  },
  hannah: {
    description:
      "A market researcher who digs into competitors, sizes up markets, and surfaces the trends that matter — turning scattered signals into a clear, sourced briefing you can act on.",
    llm: ["GPT-4o", "Perplexity"],
    hosting: "EU · Frankfurt",
    capabilities: ["Market Research", "Competitive Analysis", "Trends"],
    examples: [
      "Profile a competitor in depth",
      "Summarize a market landscape",
      "Surface emerging trends",
    ],
  },
  nori: {
    description:
      "A versatile research-and-writing assistant for answering hard questions, drafting clear documents, and distilling long, dense material down to the essentials without losing the nuance.",
    llm: ["Claude 3.5 Sonnet"],
    hosting: "EU · Frankfurt",
    capabilities: ["Research", "Writing", "Summarization"],
    examples: [
      "Answer a tough research question",
      "Draft a clear document",
      "Summarize a long report",
    ],
  },
  xavi: {
    description:
      "A social-video specialist that cuts short-form clips, plans content calendars, and writes scroll-stopping captions tuned to each platform's audience and format.",
    llm: ["GPT-4o"],
    hosting: "EU · Amsterdam",
    capabilities: ["Video Editing", "Social Media", "Content"],
    examples: [
      "Cut a short-form video",
      "Plan a content calendar",
      "Write punchy social captions",
    ],
  },
};

// Short one-line taglines (the `caption` field), distinct from the long description.
const CAPTIONS: Record<string, string> = {
  elena: "Project lead",
  alex: "Senior engineer",
  "coding-agent": "Autonomous builder",
  deckster: "Presentation designer",
  demos: "Rapid prototyper",
  hannah: "Market researcher",
  nori: "Research & writing",
  xavi: "Social video specialist",
};

// Recommend/sort weight (Coworker.priority) — higher surfaces first. Elena and
// the other Serviceplan coworkers get the highest weight so Serviceplan leads
// and Elena is first within it.
const PRIORITY: Record<string, number> = {
  elena: 100,
  alex: 90,
  hannah: 70,
  nori: 65,
  "coding-agent": 60,
  deckster: 55,
  demos: 50,
  xavi: 45,
};

// Curated, pre-filled task offers shown in the agents marketplace.
// `description` / `deliverable` are shown in the offer card + detail dialog.
// `exampleUrl` (+ `exampleType`) point at a sample output (PDF/image); leave
// undefined to show the "example coming soon" placeholder in the UI.
interface Offer {
  title: string;
  prompt: string;
  category: string;
  description?: string;
  deliverable?: string;
  outputs?: Array<{
    type: "pdf" | "image" | "slides" | "doc" | "text";
    url?: string;
    label?: string;
    text?: string;
  }>;
}

const OFFERS: Record<string, Offer[]> = {
  elena: [
    {
      title: "Competitive analysis",
      prompt:
        "Run a competitive analysis of my top 3 competitors and summarize their positioning, strengths, and gaps in a short brief. Competitors: ",
      category: "Research",
      description:
        "A sourced, side-by-side look at your top competitors — how they position, price, and win — plus the gaps you can move on.",
      deliverable:
        "A 2–3 page PDF brief with a comparison table and takeaways.",
      outputs: [
        {
          type: "pdf",
          url: "https://c-ipfs-gw.nmkr.io/ipfs/QmR3E3QrDy2TMhdrwKD4JcvsvCzZVv9TkicPCqwDSLUPHp",
          label: "Competitive brief",
        },
      ],
    },
    {
      title: "Project plan from a goal",
      prompt:
        "Turn this goal into a clear, sequenced project plan with milestones and owners. Goal: ",
      category: "Planning",
      description:
        "Turns a fuzzy goal into a sequenced plan — milestones, owners, and dependencies mapped so everyone knows what happens next.",
      deliverable:
        "A structured project plan with milestones, owners, and a timeline.",
      outputs: [
        {
          type: "text",
          label: "Project plan",
          text: `## Launch the new pricing page — project plan

**Goal:** Ship a redesigned pricing page that lifts trial sign-ups, live by end of Q3.

### Milestones

1. **Discovery & research** — _Week 1–2_ · Owner: Elena
   - Audit the current funnel and competitor pricing pages
   - 5 user interviews on pricing confusion
2. **Design** — _Week 3–4_ · Owner: Priya
   - Wireframes → high-fidelity, two review rounds
   - _Depends on:_ Discovery sign-off
3. **Build** — _Week 5–7_ · Owner: Marco
   - Front-end + experiment instrumentation
   - _Depends on:_ Final design
4. **Launch & measure** — _Week 8_ · Owner: Elena
   - A/B test against the current page, watch the sign-up rate

### Dependencies

- Design can't start until research findings are signed off.
- Build is blocked on final copy from Marketing (due Week 4).

### Risks

- ⚠️ Copy approval is on the critical path — pull it forward if you can.
- ⚠️ The experiment needs ~2 weeks of traffic to reach significance.`,
        },
      ],
    },
    {
      title: "Weekly status summary",
      prompt:
        "Summarize the current status of my project across all workstreams, flag risks, and list what's next.",
      category: "Coordination",
      description:
        "A clear read on where every workstream stands — what shipped, what's at risk, and what's next — in one shareable update.",
      deliverable: "A concise status report you can forward to stakeholders.",
      outputs: [
        {
          type: "text",
          label: "Status update",
          text: `## Weekly status — week of June 9

**Overall:** 🟢 On track for the Q3 launch.

### Shipped this week

- ✅ Pricing-page wireframes approved
- ✅ Experiment tracking spec finalized

### In progress

- 🔵 High-fidelity designs (80%) — Priya
- 🔵 Front-end build kicked off — Marco

### At risk

- 🟠 Marketing copy is ~3 days behind, and it sits on the build critical path.

### What's next

- Finalize designs (Wed)
- Copy review with Marketing (Thu)
- Begin experiment instrumentation (Fri)`,
        },
      ],
    },
  ],
  alex: [
    {
      title: "Code review",
      prompt:
        "Review this pull request for bugs, edge cases, and readability, and explain any issues in plain language. PR / diff: ",
      category: "Engineering",
      description:
        "A thorough review of your pull request — bugs, edge cases, and readability — with every issue explained in plain language.",
      deliverable: "Inline review notes plus a prioritized summary of fixes.",
    },
    {
      title: "Fix a failing test",
      prompt:
        "Track down why this test is failing and propose a fix. Test and error output: ",
      category: "Engineering",
      description:
        "Tracks down why a test is failing, explains the root cause, and proposes a concrete, ready-to-apply fix.",
      deliverable: "A root-cause explanation and a proposed fix.",
    },
    {
      title: "Write a script",
      prompt: "Write a Python or TypeScript script that does the following: ",
      category: "Engineering",
      description:
        "A small, well-structured Python or TypeScript script that does exactly what you describe — documented and ready to run.",
      deliverable: "A documented, runnable script with usage notes.",
    },
  ],
  hannah: [
    {
      title: "Competitor deep-dive",
      prompt:
        "Profile this competitor in depth — product, pricing, positioning, and recent moves. Competitor: ",
      category: "Research",
      description:
        "An in-depth profile of a single competitor — product, pricing, positioning, and recent moves — with sources you can verify.",
      deliverable: "A sourced competitor profile in PDF.",
    },
    {
      title: "Market landscape",
      prompt:
        "Summarize the market landscape — key players, trends, and opportunities. Segment: ",
      category: "Research",
      description:
        "A map of the market — key players, trends, and where the opportunities are — distilled from scattered signals.",
      deliverable: "A market landscape brief with key players and trends.",
    },
  ],
  "coding-agent": [
    {
      title: "Scaffold a feature",
      prompt:
        "Scaffold this feature end-to-end with the integrations wired up. Feature: ",
      category: "Engineering",
      description:
        "Stands up a feature end-to-end — the structure, the integrations, and the wiring — so your team starts from working code.",
      deliverable: "A scaffolded feature branch with integrations wired up.",
    },
    {
      title: "Refactor a module",
      prompt:
        "Refactor this module for clarity and maintainability without changing behavior. Code / path: ",
      category: "Engineering",
      description:
        "Restructures a messy module for clarity and maintainability — without changing its behavior.",
      deliverable: "A refactored module with a summary of changes.",
    },
  ],
  deckster: [
    {
      title: "Pitch deck from a brief",
      prompt:
        "Build a pitch deck from this brief — clear narrative, clean slides, speaker-ready. Brief: ",
      category: "Presentations",
      description:
        "A polished, on-brand pitch deck built from your brief — clear narrative, clean slides, and a speaker-ready flow.",
      deliverable: "A presentation deck (slides/PDF) ready to present.",
      outputs: [
        {
          type: "slides",
          url: "https://c-ipfs-gw.nmkr.io/ipfs/QmcvHYQaoaAR2Q2DZbN6FZk5GuKZAn8dJxTv9iUn58PZfm",
          label: "Pitch deck",
        },
        {
          type: "pdf",
          url: "https://c-ipfs-gw.nmkr.io/ipfs/QmR3E3QrDy2TMhdrwKD4JcvsvCzZVv9TkicPCqwDSLUPHp",
          label: "One-page summary",
        },
      ],
    },
    {
      title: "Turn notes into slides",
      prompt:
        "Turn these rough notes into a polished, on-brand slide deck. Notes: ",
      category: "Presentations",
      description:
        "Turns rough notes into a structured, on-brand slide deck — no more staring at a blank canvas.",
      deliverable: "A clean slide deck built from your notes.",
    },
  ],
  demos: [
    {
      title: "Spin up a demo flow",
      prompt:
        "Spin up a quick demo flow that shows this idea in action. Idea: ",
      category: "Prototyping",
      description:
        "A quick, clickable demo flow that shows your idea in action instead of describing it in a document.",
      deliverable: "A working demo flow you can share.",
    },
  ],
  nori: [
    {
      title: "Answer a research question",
      prompt: "Research and answer this question with sources. Question: ",
      category: "Research",
      description:
        "A clear, sourced answer to a hard question — the nuance kept, the noise cut.",
      deliverable: "A sourced written answer.",
    },
    {
      title: "Summarize a long report",
      prompt:
        "Summarize this long report down to the essentials without losing nuance. Report / link: ",
      category: "Writing",
      description:
        "Distills a long, dense report down to the essentials — without losing the nuance that matters.",
      deliverable: "A concise summary with the key points.",
    },
  ],
  xavi: [
    {
      title: "Cut a short-form video",
      prompt:
        "Cut a short-form video from this footage/brief for the given platform. Details: ",
      category: "Social",
      description:
        "A platform-ready short-form cut from your footage or brief — paced for the feed and tuned to the platform.",
      deliverable: "An edited short-form video file.",
    },
    {
      title: "Plan a content calendar",
      prompt:
        "Plan a 2-week content calendar across the given platforms. Brand / topic: ",
      category: "Social",
      description:
        "A two-week content calendar across your platforms — what to post, when, and why.",
      deliverable: "A 2-week content calendar.",
    },
  ],
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const prisma = createPrismaClient(url);

  for (const [slug, seed] of Object.entries(SEED)) {
    const existing = await prisma.coworker.findFirst({
      where: { slug },
      select: { id: true, metadata: true },
    });
    if (!existing) {
      console.log(`skip ${slug} (not found)`);
      continue;
    }
    const current =
      existing.metadata && typeof existing.metadata === "object"
        ? (existing.metadata as Record<string, unknown>)
        : {};
    const metadata = {
      ...current,
      channels: (current.channels as Record<string, string>) ?? {},
      profile: {
        llm: seed.llm,
        hosting: seed.hosting,
        capabilities: seed.capabilities,
        examples: seed.examples,
      },
      offers: OFFERS[slug] ?? [],
    };
    await prisma.coworker.update({
      where: { id: existing.id },
      data: {
        caption: CAPTIONS[slug] ?? null,
        description: seed.description,
        priority: PRIORITY[slug] ?? 0,
        metadata,
      },
    });
    console.log(`seeded ${slug}`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
