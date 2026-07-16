import { z } from "@hono/zod-openapi";
import type { Agent } from "@sokosumi/database";
import { RiskClassification, resolveIpfsOrHttpUrl } from "@sokosumi/utils";

import { getAgentAuthorImage } from "@/helpers/agent";
import { dateTimeSchema } from "@/helpers/datetime";
import { categorySchema } from "@/schemas/category.schema";
import { riskClassificationSchema } from "@/schemas/domain-enums.schema";

export const executionMetricsSchema = z
  .object({
    count: z
      .number()
      .openapi({ example: 100, description: "Number of executions" }),
    averageTime: z.number().nullable().openapi({
      example: 100000,
      description: "Average execution time in seconds",
    }),
  })
  .openapi({
    description: "Execution metrics",
  });

export type ExecutionMetrics = z.infer<typeof executionMetricsSchema>;

export const ratingMetricsSchema = z
  .object({
    total: z
      .number()
      .openapi({ example: 100, description: "Total number of ratings" }),
    average: z.number().nullable().openapi({
      example: 4.5,
      description:
        "Average rating (out of 5 stars). Null if there are no ratings.",
    }),
  })
  .openapi({
    description: "Rating metrics",
  });

export type RatingMetrics = z.infer<typeof ratingMetricsSchema>;

export const metricsSchema = z
  .object({
    executions: executionMetricsSchema,
    ratings: ratingMetricsSchema,
  })
  .openapi({
    description: "Execution and rating metrics",
  });

export type Metrics = z.infer<typeof metricsSchema>;

export const authorSchema = z.object({
  name: z.string().nullable().openapi({ example: "John Doe" }),
  image: z
    .string()
    .nullable()
    .openapi({ example: "https://example.com/image.png" }),
  organization: z
    .string()
    .nullable()
    .openapi({ example: "John Doe's Organization" }),
  email: z
    .preprocess((val) => {
      if (val === null || val === undefined || val === "") return null;
      try {
        z.email().parse(val);
        return val;
      } catch {
        return null;
      }
    }, z.email().nullable())
    .openapi({ example: "john.doe@example.com" }),
  other: z
    .string()
    .nullable()
    .openapi({ example: "Other contact information" }),
});

export const getAuthorFromAgent = (agent: Agent) => {
  return authorSchema.parse({
    name: agent.overrideAuthorName ?? agent.authorName,
    image: getAgentAuthorImage(agent),
    organization: agent.overrideAuthorOrganization ?? agent.authorOrganization,
    email: agent.overrideAuthorContactEmail ?? agent.authorContactEmail,
    other: agent.overrideAuthorContactOther ?? agent.authorContactOther,
  });
};

export const agentLegalSchema = z.object({
  privacyPolicy: z.string().nullable().openapi({ example: "Privacy Policy" }),
  terms: z.string().nullable().openapi({ example: "Terms of Service" }),
  dpa: z
    .string()
    .nullable()
    .openapi({ example: "Data Processing Agreement (DPA)" }),
  other: z.string().nullable().openapi({ example: "Other" }),
});

export const getAgentLegalFromAgent = (agent: Agent) => {
  return agentLegalSchema.parse({
    privacyPolicy: agent.overrideLegalPrivacyPolicy ?? agent.legalPrivacyPolicy,
    terms: agent.overrideLegalTerms ?? agent.legalTerms,
    dpa: agent.overrideLegalDpa ?? agent.legalDpa,
    other: agent.overrideLegalOther ?? agent.legalOther,
  });
};

export const agentExampleOutputSchema = z
  .object({
    name: z.string().openapi({ example: "Generated summary" }),
    mimeType: z.string().openapi({ example: "image/png" }),
    url: z.string().openapi({ example: "https://example.com/output.png" }),
  })
  .openapi("AgentExampleOutput");

export type AgentExampleOutput = z.infer<typeof agentExampleOutputSchema>;

interface AgentExampleOutputSource {
  exampleOutput: Array<{
    name: string;
    mimeType: string;
    url: string;
  }>;
  overrideExampleOutput: Array<{
    name: string;
    mimeType: string;
    url: string;
  }>;
}

export function getAgentExampleOutputsFromAgent(
  agent: AgentExampleOutputSource,
): AgentExampleOutput[] {
  const exampleOutputs =
    agent.overrideExampleOutput.length > 0
      ? agent.overrideExampleOutput
      : agent.exampleOutput;

  return exampleOutputs.map((exampleOutput) =>
    agentExampleOutputSchema.parse({
      name: exampleOutput.name,
      mimeType: exampleOutput.mimeType,
      url: resolveIpfsOrHttpUrl(exampleOutput.url),
    }),
  );
}

interface AgentTagsSource {
  tags: Array<{ name: string }>;
  overrideTags: Array<{ name: string }>;
}

export function getAgentTagsFromAgent(agent: AgentTagsSource): string[] {
  return agent.overrideTags.length > 0
    ? agent.overrideTags.map((tag) => tag.name)
    : agent.tags.map((tag) => tag.name);
}

const agentBaseSchema = z.object({
  id: z.string().openapi({ example: "agent_123" }),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  name: z.string().openapi({ example: "Research Assistant" }),
  image: z
    .string()
    .nullable()
    .openapi({ example: "https://example.com/image.png" }),
  icon: z
    .string()
    .nullable()
    .openapi({ example: "https://example.com/icon.svg" }),
  credits: z.number().openapi({
    example: 100,
    description: "Price in credits",
  }),
  summary: z.string().nullable().openapi({
    example: "A research assistant that can help you with your research",
  }),
  description: z.string().openapi({
    example: "A research assistant that can help you with your research",
  }),
  metrics: metricsSchema,
  author: authorSchema,
  legal: agentLegalSchema,
  categories: z.array(categorySchema).openapi({
    description: "Categories this agent belongs to",
  }),
});

export const agentSummarySchema = agentBaseSchema.openapi("Agent");

export const agentDetailSchema = agentBaseSchema
  .extend({
    riskClassification: riskClassificationSchema.openapi({
      example: RiskClassification.MINIMAL,
      description: "The agent's risk classification",
    }),
    tags: z.array(z.string()).openapi({
      description:
        "Resolved tags for the agent, using override tags when present",
      example: ["research", "analysis"],
    }),
    exampleOutputs: z.array(agentExampleOutputSchema).openapi({
      description:
        "Resolved example outputs for the agent, using overrides when present",
    }),
  })
  .openapi("AgentDetail");

export const ratingDistributionSchema = z
  .object({
    "1": z.number().openapi({ example: 1 }),
    "2": z.number().openapi({ example: 2 }),
    "3": z.number().openapi({ example: 4 }),
    "4": z.number().openapi({ example: 8 }),
    "5": z.number().openapi({ example: 12 }),
  })
  .openapi("AgentRatingDistribution");

export type RatingDistribution = z.infer<typeof ratingDistributionSchema>;

export const agentReviewAuthorSchema = z
  .object({
    id: z.string().openapi({ example: "user_123" }),
    name: z.string().openapi({ example: "Jane Doe" }),
    image: z
      .string()
      .nullable()
      .openapi({ example: "https://example.com/avatar.png" }),
  })
  .openapi("AgentReviewAuthor");

export const agentReviewSchema = z
  .object({
    id: z.string().openapi({ example: "rating_123" }),
    rating: z.number().min(1).max(5).openapi({ example: 5 }),
    comment: z.string().nullable().openapi({ example: "Great results." }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    user: agentReviewAuthorSchema,
  })
  .openapi("AgentReview");

export type AgentReview = z.infer<typeof agentReviewSchema>;

export const agentReviewsSchema = z
  .object({
    distribution: ratingDistributionSchema,
    ratingsWithComments: z.array(agentReviewSchema).openapi({
      description: "Recent visible ratings that include comments",
    }),
  })
  .openapi("AgentReviews");

export type AgentReviews = z.infer<typeof agentReviewsSchema>;

// Intentionally omits createdAt/updatedAt: this payload is nullable at the top
// level (null when the caller has not rated the agent), and the generated
// client's response transformer does not null-guard a nullable top-level
// object before converting its date fields — so including dates here makes the
// web client throw on the common unrated case. Consumers only need rating +
// comment; timestamps remain available via the public reviews endpoint.
export const agentMyReviewSchema = z
  .object({
    id: z.string().openapi({ example: "rating_123" }),
    rating: z.number().min(1).max(5).openapi({ example: 5 }),
    comment: z.string().nullable().openapi({ example: "Great results." }),
  })
  .openapi("AgentMyReview");

export type AgentMyReview = z.infer<typeof agentMyReviewSchema>;

export const agentMyReviewResponseSchema = agentMyReviewSchema.nullable();

export const agentsSummarySchema = z.array(agentSummarySchema);

export const agentRatingRequestSchema = z
  .object({
    rating: z
      .number()
      .int()
      .min(1)
      .max(5)
      .openapi({ example: 5, description: "Rating between 1 and 5 stars" }),
    comment: z
      .string()
      .max(1000)
      .nullish()
      .openapi({ example: "Great results.", description: "Optional comment" }),
  })
  .openapi("AgentRatingRequest");

export type AgentRatingRequest = z.infer<typeof agentRatingRequestSchema>;

export const agentRatingEligibilitySchema = z
  .object({
    eligible: z.boolean().openapi({
      example: true,
      description:
        "Whether the caller has finished at least one job with the agent and may rate it",
    }),
  })
  .openapi("AgentRatingEligibility");

export type AgentRatingEligibility = z.infer<
  typeof agentRatingEligibilitySchema
>;
