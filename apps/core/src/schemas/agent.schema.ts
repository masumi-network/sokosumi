import { z } from "@hono/zod-openapi";
import type { Agent } from "@sokosumi/database";

import { getAgentAuthorImage } from "@/helpers/agent";
import { dateTimeSchema } from "@/helpers/datetime";

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
  organization: z.string().nullable().openapi({ example: "John Doe" }),
  email: z
    .email()
    .nullable()
    .catch(null)
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
  other: z.string().nullable().openapi({ example: "Other" }),
});

export const getAgentLegalFromAgent = (agent: Agent) => {
  return agentLegalSchema.parse({
    privacyPolicy: agent.overrideLegalPrivacyPolicy ?? agent.legalPrivacyPolicy,
    terms: agent.overrideLegalTerms ?? agent.legalTerms,
    other: agent.overrideLegalOther ?? agent.legalOther,
  });
};

export const agentSchema = z
  .object({
    id: z.string().openapi({ example: "agent_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    name: z.string().openapi({ example: "Research Assistant" }),
    image: z
      .string()
      .nullable()
      .openapi({ example: "https://example.com/image.png" }),
    credits: z.number().openapi({
      example: 100,
      description: "Price in credits including fee",
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
  })
  .openapi("Agent");

export const agentsSchema = z.array(agentSchema);
