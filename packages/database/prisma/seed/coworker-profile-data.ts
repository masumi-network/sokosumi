export interface CoworkerProfileSeed {
  description: string;
  llm: string[];
  hosting: string;
  capabilities: string[];
  examples: string[];
}

export interface CoworkerOfferOutput {
  type: "pdf" | "image" | "slides" | "doc" | "text";
  url?: string;
  label?: string;
  text?: string;
}

export interface CoworkerOffer {
  title: string;
  prompt: string;
  category: string;
  description?: string;
  deliverable?: string;
  outputs?: CoworkerOfferOutput[];
}

export const COWORKER_PROFILE_SEED: Record<string, CoworkerProfileSeed> = {
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
};

export const COWORKER_CAPTIONS: Record<string, string> = {
  elena: "Project lead",
  alex: "Senior engineer",
  hannah: "Market researcher",
  nori: "Research & writing",
};

export const COWORKER_PRIORITY: Record<string, number> = {
  elena: 100,
  alex: 90,
  hannah: 70,
  nori: 65,
};

export const COWORKER_OFFERS: Record<string, CoworkerOffer[]> = {
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
    },
    {
      title: "Weekly status summary",
      prompt:
        "Summarize the current status of my project across all workstreams, flag risks, and list what's next.",
      category: "Coordination",
      description:
        "A clear read on where every workstream stands — what shipped, what's at risk, and what's next — in one shareable update.",
      deliverable: "A concise status report you can forward to stakeholders.",
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
};

export const COWORKER_DISPLAY_NAMES: Record<string, string> = {
  elena: "Elena",
  alex: "Alex",
  hannah: "Hannah",
  nori: "Nori",
};
