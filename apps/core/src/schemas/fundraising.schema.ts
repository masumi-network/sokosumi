import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import { contactPersonSchema, contactSchema } from "@/schemas/contact.schema";

/** The pipeline's order. */
export const FUNDRAISING_STAGES = [
  "TO_RESEARCH",
  "WARM_PATH",
  "REACHED_OUT",
  "MEETING",
  "DATA_ROOM",
  "DILIGENCE",
  "COMMITTED",
  "PASSED",
] as const;

export const fundraisingStageSchema = z
  .enum(FUNDRAISING_STAGES)
  .openapi("FundraisingStage");

export const fundraisingAccessSchema = z
  .object({
    /** Whether this workspace's organization has Fundraising. */
    enabled: z.boolean(),
  })
  .openapi("FundraisingAccess");

/** What one investor did in a data room, matched by email. */
export const fundraisingDataRoomVisitSchema = z
  .object({
    roomId: z.uuid(),
    roomTitle: z.string(),
    memberId: z.uuid(),
    email: z.string(),
    invitedAt: dateTimeSchema,
    firstVisitAt: dateTimeSchema.nullable(),
    lastVisitAt: dateTimeSchema.nullable(),
    views: z.int(),
    downloads: z.int(),
    /** The file they opened last, relative to the room. */
    lastOpened: z.string().nullable(),
    revoked: z.boolean(),
  })
  .openapi("FundraisingDataRoomVisit");

export const fundraisingResearchSchema = z
  .object({
    /** Exa spend on research in this workspace this calendar month. */
    monthUsd: z.number(),
    capUsd: z.number(),
    perSearchUsd: z.number(),
    exaConfigured: z.boolean(),
  })
  .openapi("FundraisingResearch");

export const fundraisingProspectSchema = z
  .object({
    contact: contactSchema,
    stage: fundraisingStageSchema,
    /** Null while nobody moved them off the first stage. */
    stageChangedAt: dateTimeSchema.nullable(),
    owner: z.union([contactPersonSchema, z.null()]),
    ticketSize: z.string().nullable(),
    thesis: z.string().nullable(),
    committedUsd: z.int().nullable(),
    notes: z.string().nullable(),
    source: z.string().nullable(),
    dataRoom: z.union([fundraisingDataRoomVisitSchema, z.null()]),
  })
  .openapi("FundraisingProspect");

export const fundraisingPipelineSchema = z
  .object({
    /** The workspace's "Investors" list; null until someone makes one. */
    list: z.union([z.object({ id: z.uuid(), name: z.string() }), z.null()]),
    rooms: z.array(
      z.object({ id: z.uuid(), title: z.string(), token: z.string() }),
    ),
    prospects: z.array(fundraisingProspectSchema),
    research: fundraisingResearchSchema,
  })
  .openapi("FundraisingPipeline");

export const fundraisingProspectUpdateSchema = z
  .object({
    stage: fundraisingStageSchema.optional(),
    ownerUserId: z.string().min(1).nullable().optional(),
    ticketSize: z.string().trim().max(120).nullable().optional(),
    thesis: z.string().trim().max(2000).nullable().optional(),
    committedUsd: z.int().min(0).nullable().optional(),
    notes: z.string().trim().max(10_000).nullable().optional(),
    source: z.string().trim().max(120).nullable().optional(),
  })
  .openapi("FundraisingProspectUpdate");

export type FundraisingStage = (typeof FUNDRAISING_STAGES)[number];
export type FundraisingProspectUpdate = z.infer<
  typeof fundraisingProspectUpdateSchema
>;
export type FundraisingProspectDto = z.input<typeof fundraisingProspectSchema>;
export type FundraisingPipelineDto = z.input<typeof fundraisingPipelineSchema>;
export type FundraisingDataRoomVisitDto = z.input<
  typeof fundraisingDataRoomVisitSchema
>;

/** How many investors one search asks Exa for. */
export const FUNDRAISING_SEARCH_SIZES = [10, 25] as const;

export const fundraisingFindInputSchema = z
  .object({
    /** Who to look for: stage, sector, geography, cheque size, anything that narrows it. */
    brief: z.string().trim().min(10).max(1500),
    size: z.union([z.literal(10), z.literal(25)]).default(10),
  })
  .openapi("FundraisingFindInput");

export const fundraisingFindResultSchema = z
  .object({
    found: z.int(),
    /** What Exa charged for this search. */
    costUsd: z.number(),
    research: fundraisingResearchSchema,
  })
  .openapi("FundraisingFindResult");

export const fundraisingSuggestionIdsSchema = z
  .object({ ids: z.array(z.uuid()).min(1).max(100) })
  .openapi("FundraisingSuggestionIds");

export type FundraisingResearchDto = z.input<typeof fundraisingResearchSchema>;

export const fundraisingPortfolioCompanySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    website: z.string().nullable(),
    round: z.string().nullable(),
    date: z.string().nullable(),
    amountUsd: z.int().nullable(),
    sourceUrl: z.string(),
    fetchedAt: dateTimeSchema,
  })
  .openapi("FundraisingPortfolioCompany");

export const FUNDRAISING_PATH_KINDS = [
  "direct",
  "linkedin",
  "fund",
  "portfolio",
] as const;

/** One way to reach an investor, strongest first. */
export const fundraisingPathSchema = z
  .object({
    kind: z.enum(FUNDRAISING_PATH_KINDS).openapi("FundraisingPathKind"),
    /** The teammate who holds the relationship; null when nobody has been in touch. */
    via: z.union([contactPersonSchema, z.null()]),
    /** The teammate is connected to the person on LinkedIn (from an import). */
    linkedIn: z.boolean(),
    /** The contact the path runs through; null for a direct path. */
    through: z.union([
      z.object({
        id: z.uuid(),
        name: z.string(),
        role: z.string().nullable(),
        organization: z.string().nullable(),
        avatarUrl: z.string().nullable(),
        email: z.string().nullable(),
      }),
      z.null(),
    ]),
    /** The fund, or the portfolio company the path runs through. */
    company: z.union([
      z.object({
        name: z.string(),
        round: z.string().nullable(),
        date: z.string().nullable(),
      }),
      z.null(),
    ]),
    /** 0 to 100: how much to trust this path. */
    strength: z.int(),
    touches: z.int(),
    lastTouchAt: dateTimeSchema.nullable(),
  })
  .openapi("FundraisingPath");

export const fundraisingPathsSchema = z
  .object({
    portfolio: z.array(fundraisingPortfolioCompanySchema),
    researchedAt: dateTimeSchema.nullable(),
    /** What one portfolio research run costs. */
    researchUsd: z.number(),
    paths: z.array(fundraisingPathSchema),
    research: fundraisingResearchSchema,
  })
  .openapi("FundraisingPaths");

export type FundraisingPathDto = z.input<typeof fundraisingPathSchema>;
export type FundraisingPathsDto = z.input<typeof fundraisingPathsSchema>;
