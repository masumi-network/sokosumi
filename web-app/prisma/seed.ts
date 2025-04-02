import {
  AgentStatus,
  CreditTransactionType,
  JobStatus,
  PricingType,
  PrismaClient,
} from "@prisma/client";
import crypto from "crypto";

import { getEnvSecrets } from "@/config/env.config";

import { hashPassword } from "./util/password";

const prisma = new PrismaClient();

const agents = [
  {
    title: "Market Analysis Expert",
    description:
      "Advanced AI agent specialized in market analysis and trend prediction. Provides detailed insights and forecasts for various market sectors.",
    rating: 5,
    image: "/placeholder.svg",
    price: { amount: 20, unit: "usdm" },
    tags: ["Analytics", "Finance", "Trends", "Forecasting"],
    exampleOutputs: [
      {
        name: "Market Report",
        mimeType: "application/pdf",
        url: "https://example.com/market-report.pdf",
      },
      {
        name: "Trend Analysis",
        mimeType: "application/json",
        url: "https://example.com/trend-analysis.json",
      },
    ],
  },
  {
    title: "Content Creation Pro",
    description:
      "Creative AI agent that generates high-quality content for blogs, social media, and marketing materials. Specializes in engaging storytelling.",
    rating: 4,
    image: "/placeholder.svg",
    price: { amount: 15, unit: "usdm" },
    tags: [],
    exampleOutputs: [],
  },
  {
    title: "Data Visualization Expert",
    description:
      "Transforms complex data into beautiful, interactive visualizations. Perfect for business reports and presentations.",
    rating: 4,
    image: "/placeholder.svg",
    price: { amount: 15_000_000, unit: "lovelace" },
    tags: ["Data", "Visualization", "Reports", "Analytics"],
    exampleOutputs: [],
  },
  {
    title: "Code Review Assistant",
    description:
      "AI-powered code review expert that helps identify bugs, suggests improvements, and ensures code quality.",
    rating: 5,
    image: "/placeholder.svg",
    price: { amount: 15, unit: "usdm" },
    tags: ["Development", "Code Quality", "Bug Detection", "Best Practices"],
    exampleOutputs: [],
  },
  {
    title: "SEO Optimization Pro",
    description:
      "Specialized in optimizing content for search engines. Provides actionable recommendations for better rankings.",
    rating: 3,
    image: "/placeholder.svg",
    price: { amount: 10, unit: "usdm" },
    tags: ["SEO", "Marketing", "Content", "Analytics"],
    exampleOutputs: [],
  },
  {
    title: "Social Media Manager",
    description:
      "Manages social media presence with AI-powered content scheduling, engagement analysis, and trend tracking.",
    rating: 3,
    image: "/placeholder.svg",
    price: { amount: 15, unit: "usdm" },
    tags: ["Social Media", "Marketing", "Analytics", "Engagement"],
    exampleOutputs: [],
  },
  {
    title: "Customer Support AI",
    description:
      "Handles customer inquiries with natural language processing. Provides 24/7 support with human-like responses.",
    rating: 4,
    image: "/placeholder.svg",
    price: { amount: 20, unit: "usdm" },
    tags: ["Customer Service", "NLP", "24/7", "Support"],
    exampleOutputs: [],
  },
  {
    title: "Financial Advisor",
    description:
      "AI-powered financial advisor that provides personalized investment recommendations and portfolio analysis.",
    rating: 3,
    image: "/placeholder.svg",
    price: { amount: 25, unit: "usdm" },
    tags: ["Finance", "Investment", "Portfolio", "Planning"],
    exampleOutputs: [],
  },
  {
    title: "Translation Expert",
    description:
      "Professional translator supporting multiple languages with context-aware translations and cultural adaptation.",
    rating: 2,
    image: "/placeholder.svg",
    price: { amount: 10, unit: "usdm" },
    tags: ["Translation", "Languages", "Localization", "Cultural"],
    exampleOutputs: [],
  },
  {
    title: "Research Assistant",
    description:
      "Comprehensive research assistant that gathers, analyzes, and synthesizes information from various sources.",
    rating: 4,
    image: "/placeholder.svg",
    price: { amount: 15, unit: "usdm" },
    tags: ["Research", "Analysis", "Data", "Synthesis"],
    exampleOutputs: [],
  },
  {
    title: "UI/UX Designer",
    description:
      "AI-powered design assistant that creates user-friendly interfaces and provides design recommendations.",
    rating: 1,
    image: "/placeholder.svg",
    price: { amount: 20, unit: "usdm" },
    tags: ["Design", "UI", "UX", "Interface"],
    exampleOutputs: [],
  },
  {
    title: "Legal Document Analyzer",
    description:
      "Specialized in analyzing legal documents, contracts, and agreements. Identifies potential issues and risks.",
    image: "/placeholder.svg",
    price: { amount: 25, unit: "usdm" },
    tags: ["Legal", "Documents", "Contracts", "Compliance"],
    exampleOutputs: [],
  },
  {
    title: "Video Content Creator",
    description:
      "Creates engaging video content, including scripts, storyboards, and editing recommendations.",
    rating: 4,
    image: "/placeholder.svg",
    price: { amount: 30, unit: "usdm" },
    tags: ["Video", "Content", "Storytelling", "Production"],
    exampleOutputs: [],
  },
  {
    title: "HR Assistant",
    description:
      "Helps with recruitment, employee onboarding, and HR documentation. Streamlines HR processes.",
    rating: 3,
    image: "/placeholder.svg",
    price: { amount: 15, unit: "usdm" },
    tags: ["HR", "Recruitment", "Onboarding", "Documentation"],
    exampleOutputs: [],
  },
  {
    title: "Project Manager",
    description:
      "AI project manager that helps with task tracking, resource allocation, and project timeline optimization.",
    rating: 4,
    image: "/placeholder.svg",
    price: { amount: 20, unit: "usdm" },
    tags: ["Project Management", "Planning", "Resources", "Timeline"],
    exampleOutputs: [],
  },
];

const seedDatabase = getEnvSecrets().SEED_DATABASE;

const seedUser = async (): Promise<string> => {
  let user = await prisma.user.findFirst({
    where: {
      email: "dev@sokosumi.com",
    },
  });

  if (user) {
    console.log("User already exists, skipping...");
    return user.id;
  }

  user = await prisma.user.create({
    data: {
      email: getEnvSecrets().SEED_USER_EMAIL,
      name: "Sokosumi Developer",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  console.log(`User created with email ${user.email}`);

  const password = await hashPassword(getEnvSecrets().SEED_USER_PASSWORD);

  const account = await prisma.account.create({
    data: {
      id: crypto.randomUUID(),
      userId: user.id,
      providerId: "credential",
      accountId: crypto.randomUUID(),
      password: password,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  console.log(`Account created with id ${account.id}`);
  return user.id;
};

const seedAgents = async () => {
  let index = 0;
  for (const agent of agents) {
    console.log(
      `Processing agent ${agent.title} (${index + 1}/${agents.length})`,
    );

    // Check if agent already exists
    const existingAgent = await prisma.agent.findFirst({
      where: {
        blockchainIdentifier: `demo-${index + 1}-${agent.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      },
    });

    if (existingAgent) {
      console.log(`Agent ${agent.title} already exists, skipping...`);
      index++;
      continue;
    }

    const pricing = await prisma.agentPricing.create({
      data: {
        pricingType: PricingType.Fixed,
        fixedPricing: {
          create: {
            amounts: {
              create: {
                unit: agent.price.unit,
                amount: BigInt(agent.price.amount),
              },
            },
          },
        },
      },
    });

    const exampleOutputs = agent.exampleOutputs.map((output) => ({
      name: output.name,
      mimeType: output.mimeType,
      url: output.url,
    }));

    await prisma.agent.create({
      data: {
        name: agent.title,
        description: agent.description,
        uptimeCheckCount: 0,
        uptimeCount: 0,
        lastUptimeCheck: new Date(),
        image: agent.image,
        apiBaseUrl: "https://api.example.com/agent",
        capabilityName: agent.title,
        capabilityVersion: "1.0.0",
        authorName: "Demo Author",
        tags: {
          connectOrCreate: agent.tags.map((tag) => ({
            where: { name: tag },
            create: { name: tag },
          })),
        },
        metadataVersion: 1,
        rating: {
          create: {
            totalStars: BigInt(agent.rating ?? 0),
            totalRatings: BigInt(agent.rating ? 1 : 0),
          },
        },
        // No overrides initially
        overrideName: null,
        overrideDescription: null,
        overrideImage: null,
        overrideApiBaseUrl: null,
        overrideCapabilityName: null,
        overrideCapabilityVersion: null,
        overrideAuthorName: null,
        overrideTags: {
          create: [],
        },
        pricing: {
          connect: {
            id: pricing.id,
          },
        },
        blockchainIdentifier: `demo-${index + 1}-${agent.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        status: AgentStatus.ONLINE,
        showOnFrontPage: true,
        ranking: BigInt(index + 1),

        exampleOutput: {
          create: exampleOutputs,
        },
      },
    });

    console.log(`Created agent ${agent.title}`);
    index++;
  }
};

const seedJobs = async (userId: string) => {
  const agents = await prisma.agent.findMany({
    include: {
      jobs: true,
    },
  });

  for (const agent of agents) {
    if (agent.jobs.length > 0) {
      console.log(`Agent ${agent.name} already has jobs, skipping...`);
      continue;
    }
    const numJobs = Math.floor(Math.random() * 51); // 0 to 50 jobs

    const jobPromises = Array.from({ length: numJobs }, async (_, index) => {
      const status = [
        "PAYMENT_PENDING",
        "PAYMENT_FAILED",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
      ][Math.floor(Math.random() * 5)] as JobStatus;

      const startedAt = new Date();
      startedAt.setDate(startedAt.getDate() - Math.floor(Math.random() * 30)); // Random date within last 30 days

      const finishedAt =
        status === JobStatus.COMPLETED ||
        status === JobStatus.FAILED ||
        status === JobStatus.PAYMENT_FAILED
          ? new Date(startedAt.getTime() + Math.random() * 24 * 60 * 60 * 1000) // Random time within 24 hours of start
          : null;

      const cost =
        BigInt(Math.floor(Math.random() * 1000) + 1) * BigInt(100000000000); // Random cost between 1 and 1001 (100000000000 as decimal multiplier)
      const fee = BigInt(Math.floor(Number(cost) * 0.05)); // 5% fee

      const jobInputs = [
        "Analyze market trends for emerging technologies",
        "Generate quarterly financial report",
        "Create content strategy for social media",
        "Perform competitor analysis",
        "Optimize website SEO",
        "Review code for security vulnerabilities",
        "Generate marketing copy for new product",
        "Translate document to multiple languages",
        "Create data visualization dashboard",
        "Analyze customer feedback sentiment",
      ];

      const input = jobInputs[Math.floor(Math.random() * jobInputs.length)];
      const output =
        status === JobStatus.COMPLETED
          ? `Completed analysis for: ${input}`
          : null;

      const creditTransaction = await prisma.creditTransaction.create({
        data: {
          amount: cost,
          includedFee: fee,
          type: CreditTransactionType.SPEND,
          userId,
        },
      });
      await prisma.creditTransaction.create({
        data: {
          amount: cost * BigInt(5),
          includedFee: 0,
          type: CreditTransactionType.TOP_UP,
          userId,
        },
      });

      return prisma.job.create({
        data: {
          agentId: agent.id,
          blockchainIdentifier: `demo-blockchainIdentifier-${agent.id}-${index}`,
          userId,
          status,
          input,
          output,
          startedAt,
          finishedAt,
          creditTransactionId: creditTransaction.id,
          agentJobId: `demo-agentJobId-${agent.id}-${index}`,
          paymentId: `demo-paymentId-${agent.id}-${index}`,
        },
      });
    });

    await Promise.all(jobPromises);
    console.log(`Created ${numJobs} jobs for agent ${agent.name}`);
  }
};

const seedCreditCost = async () => {
  console.log("Seeding credit cost...");
  await prisma.creditCost.upsert({
    where: {
      unit: "usdm",
    },
    update: {
      creditCostPerUnit: BigInt(1),
    },
    create: {
      unit: "usdm",
      creditCostPerUnit: BigInt(1),
    },
  });
  console.log("USDM credit cost seeded");

  await prisma.creditCost.upsert({
    where: {
      unit: "",
    },
    update: {
      creditCostPerUnit: BigInt(1_000_000),
    },
    create: {
      unit: "",
      creditCostPerUnit: BigInt(1_000_000),
    },
  });
  console.log("Lovelace credit cost seeded");
};

async function main() {
  if (seedDatabase) {
    const userId = await seedUser();
    await seedAgents();
    await seedJobs(userId);
  }
  await seedCreditCost();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
