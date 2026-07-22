/**
 * Dev-only seed: populate a handful of marketplace agents + categories so the
 * Agents / Tasks / Chat pages are explorable in a local/cloud dev environment
 * without a real Masumi registry sync.
 *
 * These are MOCK agents — they point at a non-routable apiBaseUrl and cannot
 * actually run jobs. They exist purely to render the marketplace UI. For real
 * hire/job flows, run the registry sync against Preprod instead.
 *
 * Requires the `lovelace` credit_cost row to exist (FIXED pricing is only
 * "available" when every pricing unit is present in CreditCost). Safe to
 * re-run: agents are upserted by their unique blockchainIdentifier and
 * categories by their unique slug.
 *
 * Run against a dev DB only:
 *   DATABASE_URL="postgres://..." npx tsx packages/database/scripts/seed-dev-marketplace.ts
 */
import { createPrismaClient } from "../src/client";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const prisma = createPrismaClient(DATABASE_URL);

interface CategorySeed {
  slug: string;
  name: string;
  description: string;
  priority: number;
}

const CATEGORIES: CategorySeed[] = [
  {
    slug: "writing",
    name: "Writing",
    description: "Drafting, editing, and summarization agents.",
    priority: 10,
  },
  {
    slug: "development",
    name: "Development",
    description: "Coding, review, and debugging agents.",
    priority: 20,
  },
  {
    slug: "research",
    name: "Research",
    description: "Search, analysis, and synthesis agents.",
    priority: 30,
  },
];

interface AgentSeed {
  blockchainIdentifier: string;
  name: string;
  description: string;
  authorOrganization: string;
  categorySlugs: string[];
  // Fixed price in lovelace; omit for a FREE agent.
  priceLovelace?: bigint;
}

const AGENTS: AgentSeed[] = [
  {
    blockchainIdentifier: "dev-mock-agent-copywriter",
    name: "Copywriter",
    description:
      "Turns a short brief into polished marketing copy, product descriptions, and social posts.",
    authorOrganization: "Sokosumi Dev",
    categorySlugs: ["writing"],
    priceLovelace: 2_000_000n, // 2 ADA -> 200 credits
  },
  {
    blockchainIdentifier: "dev-mock-agent-code-reviewer",
    name: "Code Reviewer",
    description:
      "Reviews a diff for bugs, style, and security issues and explains each finding in plain language.",
    authorOrganization: "Sokosumi Dev",
    categorySlugs: ["development"],
    priceLovelace: 5_000_000n, // 5 ADA -> 500 credits
  },
  {
    blockchainIdentifier: "dev-mock-agent-researcher",
    name: "Researcher",
    description:
      "Runs a multi-source web sweep and returns a cited synthesis of the findings.",
    authorOrganization: "Sokosumi Dev",
    categorySlugs: ["research", "writing"],
    // FREE agent (no priceLovelace) — always available regardless of credit costs.
  },
];

async function seedCategories(): Promise<Map<string, string>> {
  const bySlug = new Map<string, string>();
  for (const category of CATEGORIES) {
    const record = await prisma.category.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        description: category.description,
        priority: category.priority,
      },
      create: {
        slug: category.slug,
        name: category.name,
        description: category.description,
        priority: category.priority,
      },
    });
    bySlug.set(category.slug, record.id);
    console.log(`category: ${category.slug}`);
  }
  return bySlug;
}

async function seedAgent(
  seed: AgentSeed,
  categoryIdBySlug: Map<string, string>,
): Promise<void> {
  const categoryConnect = seed.categorySlugs
    .map((slug) => categoryIdBySlug.get(slug))
    .filter((id): id is string => Boolean(id))
    .map((id) => ({ id }));

  // Build the pricing graph. FIXED needs an AgentFixedPricing with lovelace
  // amounts; FREE needs only the pricingType.
  const pricingCreate =
    seed.priceLovelace === undefined
      ? { pricingType: "FREE" as const }
      : {
          pricingType: "FIXED" as const,
          fixedPricing: {
            create: {
              amounts: {
                create: [{ unit: "lovelace", amount: seed.priceLovelace }],
              },
            },
          },
        };

  const existing = await prisma.agent.findUnique({
    where: { blockchainIdentifier: seed.blockchainIdentifier },
    select: { id: true },
  });

  if (existing) {
    // Keep re-runs simple: refresh the mutable descriptive fields + categories.
    await prisma.agent.update({
      where: { id: existing.id },
      data: {
        name: seed.name,
        description: seed.description,
        authorOrganization: seed.authorOrganization,
        status: "ONLINE",
        isShown: true,
        categories: { set: categoryConnect },
      },
    });
    console.log(`agent: ${seed.blockchainIdentifier} (updated)`);
    return;
  }

  await prisma.agent.create({
    data: {
      blockchainIdentifier: seed.blockchainIdentifier,
      name: seed.name,
      description: seed.description,
      apiBaseUrl: "https://mock.invalid/agent",
      authorOrganization: seed.authorOrganization,
      lastUptimeCheck: new Date(),
      uptimeCount: 100,
      uptimeCheckCount: 100,
      status: "ONLINE",
      isShown: true,
      pricing: { create: pricingCreate },
      categories: { connect: categoryConnect },
    },
  });
  console.log(`agent: ${seed.blockchainIdentifier} (created)`);
}

async function main(): Promise<void> {
  const creditCostCount = await prisma.creditCost.count();
  if (creditCostCount === 0) {
    console.warn(
      "warning: CreditCost table is empty — FIXED-priced agents will be hidden until a 'lovelace' credit cost exists.",
    );
  }

  const categoryIdBySlug = await seedCategories();
  for (const agent of AGENTS) {
    await seedAgent(agent, categoryIdBySlug);
  }

  console.log("dev marketplace seed complete");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
