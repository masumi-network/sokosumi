import { z } from "@hono/zod-openapi";
import { type Agent, RiskClassification } from "@sokosumi/database";
import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";

import { getAgentAuthorImage } from "@/helpers/agent";
import { dateTimeSchema } from "@/helpers/datetime";
import { categorySchema } from "@/schemas/category.schema";
import type { AgentWithExampleOutput, AgentWithTags } from "@/types/agent";

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

export function getAgentExampleOutputsFromAgent(
  agent: AgentWithExampleOutput,
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

export function getAgentTagsFromAgent(agent: AgentWithTags): string[] {
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

export const agentSummarySchema = agentBaseSchema.openapi("AgentSummary");

export const agentDetailSchema = agentBaseSchema
  .extend({
    riskClassification: z.nativeEnum(RiskClassification).openapi({
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

export const agentsSummarySchema = z.array(agentSummarySchema);
