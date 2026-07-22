import {
  AgentStatus,
  PaymentType,
  PricingType,
  RiskClassification,
} from "../../src/generated/prisma/client.js";
import type { SeedContext } from "./context.js";
import {
  FIXTURE_AGENT_BLOCKCHAIN_IDS,
  FIXTURE_CATEGORY_SLUGS,
} from "./fixtures.js";

const LOVELACE_UNIT = "lovelace";
const API_BASE_URL = "https://seed-agent.local/api";

interface AgentFixture {
  blockchainIdentifier: string;
  name: string;
  pricingType: PricingType;
  fixedAmount?: bigint;
  categorySlug: keyof typeof FIXTURE_CATEGORY_SLUGS;
}

const AGENT_FIXTURES: AgentFixture[] = [
  {
    blockchainIdentifier: FIXTURE_AGENT_BLOCKCHAIN_IDS.freeAgent,
    name: "Seed Free Agent",
    pricingType: PricingType.FREE,
    categorySlug: "research",
  },
  {
    blockchainIdentifier: FIXTURE_AGENT_BLOCKCHAIN_IDS.fixedAgent,
    name: "Seed Fixed Agent",
    pricingType: PricingType.FIXED,
    fixedAmount: 10_000_000_000n,
    categorySlug: "research",
  },
  {
    blockchainIdentifier: FIXTURE_AGENT_BLOCKCHAIN_IDS.fixedAgentTwo,
    name: "Seed Fixed Agent Two",
    pricingType: PricingType.FIXED,
    fixedAmount: 5_000_000_000n,
    categorySlug: "engineering",
  },
];

const CATEGORY_FIXTURES = [
  {
    slug: FIXTURE_CATEGORY_SLUGS.research,
    name: "Research",
    description: "Research and analysis agents",
    priority: 100,
  },
  {
    slug: FIXTURE_CATEGORY_SLUGS.engineering,
    name: "Engineering",
    description: "Coding and automation agents",
    priority: 90,
  },
] as const;

async function upsertCategory(
  ctx: SeedContext,
  fixture: (typeof CATEGORY_FIXTURES)[number],
) {
  return ctx.prisma.category.upsert({
    where: { slug: fixture.slug },
    create: {
      slug: fixture.slug,
      name: fixture.name,
      description: fixture.description,
      priority: fixture.priority,
    },
    update: {
      name: fixture.name,
      description: fixture.description,
      priority: fixture.priority,
    },
  });
}

async function upsertAgent(ctx: SeedContext, fixture: AgentFixture) {
  const { prisma, now } = ctx;
  const category = await prisma.category.findUniqueOrThrow({
    where: { slug: FIXTURE_CATEGORY_SLUGS[fixture.categorySlug] },
  });

  const existing = await prisma.agent.findUnique({
    where: { blockchainIdentifier: fixture.blockchainIdentifier },
    include: {
      pricing: { include: { fixedPricing: { include: { amounts: true } } } },
    },
  });

  if (existing) {
    return prisma.agent.update({
      where: { id: existing.id },
      data: {
        name: fixture.name,
        apiBaseUrl: API_BASE_URL,
        status: AgentStatus.ONLINE,
        isShown: true,
        lastUptimeCheck: now,
        uptimeCount: 100,
        uptimeCheckCount: 100,
        categories: { set: [{ id: category.id }] },
      },
    });
  }

  return prisma.agent.create({
    data: {
      blockchainIdentifier: fixture.blockchainIdentifier,
      name: fixture.name,
      description: `${fixture.name} for local development`,
      apiBaseUrl: API_BASE_URL,
      capabilityName: "seed-capability",
      capabilityVersion: "1.0.0",
      authorName: "Sokosumi Seed",
      lastUptimeCheck: now,
      uptimeCount: 100,
      uptimeCheckCount: 100,
      paymentType: PaymentType.WEB3_CARDANO_V1,
      status: AgentStatus.ONLINE,
      isShown: true,
      riskClassification: RiskClassification.MINIMAL,
      categories: { connect: [{ id: category.id }] },
      pricing: {
        create: {
          pricingType: fixture.pricingType,
          ...(fixture.pricingType === PricingType.FIXED && {
            fixedPricing: {
              create: {
                amounts: {
                  create: {
                    unit: LOVELACE_UNIT,
                    amount: fixture.fixedAmount ?? 1n,
                  },
                },
              },
            },
          }),
        },
      },
    },
  });
}

export async function seedCatalog(ctx: SeedContext): Promise<void> {
  for (const categoryFixture of CATEGORY_FIXTURES) {
    await upsertCategory(ctx, categoryFixture);
  }

  const [freeAgent, fixedAgent, fixedAgentTwo] = await Promise.all(
    AGENT_FIXTURES.map((fixture) => upsertAgent(ctx, fixture)),
  );

  ctx.agents = { freeAgent, fixedAgent, fixedAgentTwo };
}
