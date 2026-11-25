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
