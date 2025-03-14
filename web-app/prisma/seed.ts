import { PricingType, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const dummyAgents = [
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
    price: { amount: 1500000, unit: "lovelace" },
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

async function main() {
  let index = 0;
  for (const agent of dummyAgents) {
    console.log(
      `Processing agent ${agent.title} (${index + 1}/${dummyAgents.length})`,
    );

    // Check if agent already exists
    const existingAgent = await prisma.agent.findFirst({
      where: {
        agentIdentifier: `demo-${index + 1}-${agent.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
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
        FixedPricing: {
          create: {
            Amounts: {
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
        onChainName: agent.title,
        onChainDescription: agent.description,
        onChainImage: agent.image,
        onChainApiBaseUrl: "https://api.example.com/agent",
        onChainCapabilityName: agent.title,
        onChainCapabilityVersion: "1.0.0",
        onChainAuthorName: "Demo Author",
        onChainTags: agent.tags,
        onChainMetadataVersion: 1,
        Rating: {
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
        overrideTags: [],
        overrideMetadataVersion: null,

        Pricing: {
          connect: {
            id: pricing.id,
          },
        },
        agentIdentifier: `demo-${index + 1}-${agent.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        status: "Online",
        showOnFrontPage: true,
        ranking: BigInt(index + 1),

        ExampleOutput: {
          create: exampleOutputs,
        },
      },
    });

    console.log(`Created agent ${agent.title}`);
    index++;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
