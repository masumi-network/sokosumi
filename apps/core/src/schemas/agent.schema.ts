import { z } from "@hono/zod-openapi";
import type { Agent } from "@sokosumi/database";

import { TIME } from "@/config/constants";
import { getAgentAuthorImage } from "@/helpers/agent";
import { dateTimeSchema } from "@/helpers/datetime";

export const authorSchema = z.object({
  name: z.string().nullable().openapi({ example: "John Doe" }),
  image: z
    .string()
    .nullable()
    .openapi({ example: "https://example.com/image.png" }),
  organization: z.string().nullable().openapi({ example: "John Doe" }),
  email: z.email().nullable().openapi({ example: "john.doe@example.com" }),
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
    credits: z.number().openapi({ example: 100 }),
    summary: z.string().nullable().openapi({
      example: "A research assistant that can help you with your research",
    }),
    description: z.string().openapi({
      example: "A research assistant that can help you with your research",
    }),
    metrics: z
      .object({
        executions: z
          .object({
            count: z.number().openapi({
              example: 100,
              description: "Number of jobs executed by the agent",
            }),
            averageTime: z
              .number()
              .nullable()
              .openapi({
                example: 100000,
                description: `Average execution time of the agent in seconds in the last ${TIME.AGENT_EXECUTION_METRICS_DAYS} days`,
              }),
          })
          .openapi({
            description: "Execution metrics for the agent",
          }),
      })
      .openapi({
        description: "Performance and usage metrics for the agent",
      }),
    author: authorSchema,
    legal: agentLegalSchema,
  })
  .openapi("Agent");

export const agentsSchema = z.array(agentSchema);
