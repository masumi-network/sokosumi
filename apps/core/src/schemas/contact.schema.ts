import { z } from "@hono/zod-openapi";
import {
  CONTACT_CHANNEL_SOURCES,
  CONTACT_CHANNEL_TYPES,
  CONTACT_INTERACTION_CHANNELS,
  CONTACT_INTERACTION_DIRECTIONS,
  CONTACT_LIST_COLORS,
  CONTACT_SORT_FIELDS,
  CONTACT_STAGES,
  contactFilterSchema,
} from "@sokosumi/utils";
import { dateTimeSchema } from "@/helpers/datetime";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

export const contactStageSchema = z
  .enum(CONTACT_STAGES)
  .openapi("ContactStage");
export const contactChannelTypeSchema = z
  .enum(CONTACT_CHANNEL_TYPES)
  .openapi("ContactChannelType");
const contactListColorSchema = z
  .enum(CONTACT_LIST_COLORS)
  .openapi("ContactListColor");

const personSchema = z
  .object({ id: z.string(), name: z.string(), image: z.string().nullable() })
  .openapi("ContactPerson");

export const contactChannelSchema = z
  .object({
    id: z.uuid(),
    type: contactChannelTypeSchema,
    value: z.string(),
    label: z.string().nullable(),
    isPrimary: z.boolean(),
    source: z.enum(CONTACT_CHANNEL_SOURCES).openapi("ContactChannelSource"),
    sourceUrl: z.string().nullable(),
    verified: z.boolean(),
    createdAt: dateTimeSchema,
  })
  .openapi("ContactChannel");

const contactListRefSchema = z
  .object({ id: z.uuid(), name: z.string(), color: contactListColorSchema })
  .openapi("ContactListRef");

export const contactKnownBySchema = personSchema
  .extend({
    interactionCount: z.int(),
    lastInteractionAt: dateTimeSchema.nullable(),
  })
  .openapi("ContactKnownBy");

export const contactSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    organization: z.string().nullable(),
    role: z.string().nullable(),
    location: z.string().nullable(),
    summary: z.string().nullable(),
    whyInteresting: z.string().nullable(),
    stage: contactStageSchema,
    owner: z.union([personSchema, z.null()]),
    nextStep: z.string().nullable(),
    followUpAt: z.iso.date().nullable().openapi({ example: "2026-11-02" }),
    avatarUrl: z.string().nullable(),
    customFields: z.record(z.string(), z.unknown()),
    firstContactAt: dateTimeSchema.nullable(),
    lastContactAt: dateTimeSchema.nullable(),
    interactionCount: z.int(),
    createdByUserId: z.string().nullable(),
    createdBySokoBotId: z.string().nullable(),
    mergedIntoId: z.uuid().nullable(),
    version: z.int(),
    archivedAt: dateTimeSchema.nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    channels: z.array(contactChannelSchema),
    lists: z.array(contactListRefSchema),
    knownBy: z.array(contactKnownBySchema),
  })
  .openapi("Contact");

export const contactInteractionSchema = z
  .object({
    id: z.uuid(),
    contactId: z.uuid(),
    occurredAt: dateTimeSchema,
    channel: z
      .enum(CONTACT_INTERACTION_CHANNELS)
      .openapi("ContactInteractionChannel"),
    direction: z.union([
      z
        .enum(CONTACT_INTERACTION_DIRECTIONS)
        .openapi("ContactInteractionDirection"),
      z.null(),
    ]),
    summary: z.string(),
    sourceRef: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    user: z.union([personSchema, z.null()]),
    sokoBot: z.union([
      z
        .object({ id: z.uuid(), name: z.string().nullable() })
        .openapi("ContactSokoBot"),
      z.null(),
    ]),
    createdAt: dateTimeSchema,
  })
  .openapi("ContactInteraction");

export const contactActivitySchema = z
  .object({
    id: z.uuid(),
    kind: z
      .enum([
        "CREATED",
        "UPDATED",
        "CHANNEL_ADDED",
        "CHANNEL_REMOVED",
        "MERGED",
        "ARCHIVED",
        "UNARCHIVED",
      ])
      .openapi("ContactActivityKind"),
    changes: z.record(z.string(), z.unknown()),
    user: z.union([personSchema, z.null()]),
    sokoBot: z.union([
      z.object({ id: z.uuid(), name: z.string().nullable() }),
      z.null(),
    ]),
    createdAt: dateTimeSchema,
  })
  .openapi("ContactActivity");

export const contactMergeSuggestionSchema = z
  .object({
    reason: z.enum(["shared_channel", "same_name"]),
    contactIds: z.array(z.uuid()),
  })
  .openapi("ContactMergeSuggestion");

export const contactDetailSchema = contactSchema
  .extend({
    recentInteractions: z.array(contactInteractionSchema),
    mergeSuggestions: z.array(contactMergeSuggestionSchema),
  })
  .openapi("ContactDetail");

export const contactUpsertResultSchema = z
  .object({
    contact: contactSchema,
    created: z.boolean(),
    changed: z.boolean(),
    mergeSuggestion: z.union([contactMergeSuggestionSchema, z.null()]),
  })
  .openapi("ContactUpsertResult");

export const contactInteractionResultSchema = z
  .object({
    interaction: contactInteractionSchema,
    created: z.boolean(),
  })
  .openapi("ContactInteractionResult");

export const contactListSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    color: contactListColorSchema,
    description: z.string().nullable(),
    kind: z.enum(["manual", "smart"]),
    smartFilter: z.union([contactFilterSchema, z.null()]),
    count: z.int(),
    createdByUserId: z.string().nullable(),
    createdBySokoBotId: z.string().nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("ContactList");

export const contactDuplicateGroupSchema = z
  .object({
    name: z.string(),
    contacts: z.array(contactSchema),
  })
  .openapi("ContactDuplicateGroup");

export const contactImportResultSchema = z
  .object({
    rows: z.int(),
    created: z.int(),
    updated: z.int(),
    unchanged: z.int(),
    skipped: z.int(),
    listsCreated: z.int(),
    mergeSuggestions: z.array(contactMergeSuggestionSchema),
  })
  .openapi("ContactImportResult");

const booleanQuery = z.enum(["true", "false"]).optional();
const positiveDays = z.coerce.number().int().min(1).max(3650).optional();

/** `GET /contacts` and the CSV export: a contact filter spelled as query params. */
export const contactListQuerySchema = cursorPaginationQuerySchema.extend({
  cursor: z.uuid().optional(),
  search: z.string().trim().min(1).max(200).optional(),
  stage: contactStageSchema.optional(),
  ownerUserId: z.string().min(1).max(200).optional(),
  ownedByMe: booleanQuery,
  listId: z.uuid().optional().openapi({
    description: "A manual or smart list; a smart list applies its filter.",
  }),
  knownByUserId: z.string().min(1).max(200).optional(),
  knownByMe: booleanQuery,
  lastContactAfter: z.iso.datetime({ offset: true }).optional(),
  lastContactBefore: z.iso.datetime({ offset: true }).optional(),
  lastContactOlderThanDays: positiveDays,
  createdWithinDays: positiveDays,
  followUpDue: booleanQuery,
  hasChannel: contactChannelTypeSchema.optional(),
  hasInteractions: booleanQuery,
  archived: booleanQuery,
  sort: z.enum(CONTACT_SORT_FIELDS).default("updatedAt"),
  direction: z.enum(["asc", "desc"]).optional(),
});

export type ContactListQuery = z.infer<typeof contactListQuerySchema>;
