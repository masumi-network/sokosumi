/**
 * One-off seed: populate coworker.description (longer) and
 * coworker.metadata.profile (model / hosting / capabilities / examples) for the
 * New Task agent picker. Safe to re-run; merges with existing metadata and
 * preserves any `channels`. Run against a dev branch only:
 *
 *   DATABASE_URL="postgres://..." npx tsx packages/database/scripts/seed-coworker-profiles.ts
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
    };
    await prisma.coworker.update({
      where: { id: existing.id },
      data: { description: seed.description, metadata },
    });
    console.log(`seeded ${slug}`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
