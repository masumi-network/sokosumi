import { z } from "@hono/zod-openapi";

import {
  COWORKER_CAPABILITIES,
  normalizeCoworkerCapabilities,
} from "@/helpers/coworker-capability";
import { dateTimeSchema } from "@/helpers/datetime.js";

export const coworkerCapabilitiesSchema = z
  .array(z.enum(COWORKER_CAPABILITIES))
  .transform((capabilities) => normalizeCoworkerCapabilities(capabilities))
  .openapi({
    example: ["chat", "tasks"],
    description:
      "Enabled coworker capabilities. Empty array means the coworker has no enabled capabilities.",
  });

export const coworkerProfileSchema = z
  .object({
    llm: z
      .array(z.string())
      .optional()
      .openapi({ example: ["GPT-4o", "Claude 3.5 Sonnet"] }),
    hosting: z.string().optional().openapi({ example: "EU · Frankfurt" }),
    capabilities: z
      .array(z.string())
      .optional()
      .openapi({ example: ["Market Research", "Copywriting"] }),
    examples: z
      .array(z.string())
      .optional()
      .openapi({ example: ["Plan a multi-channel campaign"] }),
  })
  .openapi("CoworkerProfile");

export const coworkerOfferSchema = z
  .object({
    title: z.string().openapi({ example: "Competitive analysis" }),
    prompt: z.string().openapi({
      example:
        "Run a competitive analysis of my top 3 competitors and summarize their positioning.",
    }),
    category: z.string().optional().openapi({ example: "Research" }),
    description: z.string().optional().openapi({
      example:
        "A sourced, side-by-side breakdown of your top competitors — positioning, pricing, strengths, and the gaps you can exploit.",
    }),
    deliverable: z.string().optional().openapi({
      example:
        "A 2–3 page PDF brief with a comparison table and key takeaways.",
    }),
    outputs: z
      .array(
        z.object({
          type: z.enum(["pdf", "image", "slides", "doc", "text"]).openapi({
            example: "pdf",
          }),
          url: z.string().optional().openapi({
            example: "https://example.com/samples/competitive-analysis.pdf",
          }),
          label: z
            .string()
            .optional()
            .openapi({ example: "Competitive brief" }),
          text: z.string().optional().openapi({
            description:
              "Inline example content for text outputs (Markdown), shown as a sample deliverable when there is no file URL.",
            example: "## Project plan\n\n- Milestone 1 — …",
          }),
        }),
      )
      .optional()
      .openapi({
        description:
          "Example outputs the offer produces — text and/or files (PDF, slides, image).",
      }),
  })
  .openapi("CoworkerOffer");

export const coworkerMetadataSchema = z
  .object({
    channels: z.record(z.string(), z.string()).openapi({
      description:
        "Contact channels keyed by provider id (e.g. email, whatsapp).",
      example: {
        email: "foo@bar.com",
        whatsapp: "+49151xxxx",
      },
    }),
    profile: coworkerProfileSchema.optional().openapi({
      description:
        "Public agent profile shown in selection UIs (model, hosting, capabilities, examples).",
    }),
    offers: z.array(coworkerOfferSchema).optional().openapi({
      description:
        "Curated, pre-filled task offers shown in the agents marketplace.",
    }),
  })
  .openapi("CoworkerMetadata");

export type CoworkerMetadata = z.infer<typeof coworkerMetadataSchema>;

export const coworkerSummarySchema = z
  .object({
    id: z.string().openapi({ example: "cow_123" }),
    name: z.string().openapi({ example: "Ops Agent" }),
    image: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/logo" }),
    slug: z.string().openapi({ example: "ops-agent" }),
  })
  .openapi("CoworkerSummary");

export type CoworkerSummary = z.infer<typeof coworkerSummarySchema>;

export const coworkerSchema = z
  .object({
    id: z.string().openapi({ example: "cow_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    archivedAt: dateTimeSchema.nullable(),
    isWhitelisted: z.boolean().openapi({ example: true }),
    priority: z.number().int().openapi({
      example: 10,
      description:
        "Sort priority for coworker lists. Higher numbers appear first.",
    }),
    slug: z.string().openapi({ example: "ops-agent" }),
    name: z.string().openapi({ example: "Ops Agent" }),
    caption: z
      .string()
      .nullish()
      .openapi({ example: "Senior Campaign Partner" }),
    company: z.string().nullish().openapi({ example: "Serviceplan" }),
    companyLogo: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/company-logo" }),
    url: z.string().nullish().openapi({ example: "https://example.com" }),
    baseURL: z.string().nullable().openapi({
      example: "https://responses.example.com/v1",
      description:
        "OpenAI Responses API base URL used to enable this coworker for chat.",
    }),
    description: z.string().nullish().openapi({ example: "Ops helper" }),
    capabilities: coworkerCapabilitiesSchema,
    image: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/logo" }),
    metadata: z.preprocess(
      (val) => (val === undefined ? null : val),
      coworkerMetadataSchema.nullable(),
    ),
  })
  .openapi("Coworker");
