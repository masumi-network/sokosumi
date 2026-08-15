import { z } from "@hono/zod-openapi";

import {
  COWORKER_CAPABILITIES,
  normalizeCoworkerCapabilities,
} from "@/helpers/coworker-capability";
import { dateTimeSchema } from "@/helpers/datetime.js";
import { vendorSchema } from "@/schemas/vendor.schema";

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

// Canonical, semantic output kinds. Files are described by what they are, not
// by extension, so the UI can pick the right icon/preview.
const OUTPUT_TYPES = [
  "pdf",
  "image",
  "slides",
  "doc",
  "sheet",
  "text",
  "html",
] as const;

// Common file extensions / spellings → canonical kind, so a hand-filled offer
// can use the natural extension (e.g. "xlsx", "docx", "pptx", "png") instead of
// the abstract name and still validate. Unknown strings pass through unchanged
// and are then rejected by the enum.
const OUTPUT_TYPE_ALIASES: Record<string, (typeof OUTPUT_TYPES)[number]> = {
  doc: "doc",
  docx: "doc",
  slides: "slides",
  ppt: "slides",
  pptx: "slides",
  sheet: "sheet",
  xls: "sheet",
  xlsx: "sheet",
  csv: "sheet",
  pdf: "pdf",
  image: "image",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  text: "text",
  md: "text",
  markdown: "text",
  html: "html",
  htm: "html",
};
function normalizeOutputType(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return OUTPUT_TYPE_ALIASES[value.toLowerCase()] ?? value;
}

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
          type: z
            .preprocess(normalizeOutputType, z.enum(OUTPUT_TYPES))
            .openapi({
              description:
                "Output kind. Common file extensions are accepted and normalized (e.g. docx→doc, pptx→slides, xlsx/xls/csv→sheet, png/jpg→image).",
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
              "Inline example content shown when there is no file URL. For `text` outputs this is Markdown; for `html` outputs it is a full HTML document rendered in a sandboxed iframe. `html` outputs may instead point at a hosted page via `url`.",
            example: "## Project plan\n\n- Milestone 1 — …",
          }),
        }),
      )
      .optional()
      .openapi({
        description:
          "Example outputs the offer produces — text and/or files (PDF, document, slides, spreadsheet, image, html). Multiple outputs render as switchable tabs in the preview.",
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
    completedTaskCount: z.number().int().nonnegative().openapi({
      example: 12,
      description:
        "How many assigned tasks this coworker has completed, overall.",
    }),
    slug: z.string().openapi({ example: "ops-agent" }),
    name: z.string().openapi({ example: "Ops Agent" }),
    caption: z
      .string()
      .nullish()
      .openapi({ example: "Senior Campaign Partner" }),
    vendor: vendorSchema,
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
