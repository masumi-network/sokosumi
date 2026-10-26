import { z } from "@hono/zod-openapi";
import {
  CONTACT_CHANNEL_SOURCES,
  CONTACT_CHANNEL_TYPES,
  CONTACT_INTERACTION_CHANNELS,
  CONTACT_INTERACTION_DIRECTIONS,
  CONTACT_KINDS,
  CONTACT_LIST_COLORS,
  CONTACT_REPLY_STATES,
  CONTACT_SORT_FIELDS,
  CONTACT_STAGES,
  calendarDateSchema,
  contactFilterSchema,
} from "@sokosumi/utils";
import { dateTimeSchema } from "@/helpers/datetime";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

export const contactStageSchema = z
  .enum(CONTACT_STAGES)
  .openapi("ContactStage");
export const contactKindSchema = z.enum(CONTACT_KINDS).openapi("ContactKind");
export const contactReplyStateSchema = z
  .enum(CONTACT_REPLY_STATES)
  .openapi("ContactReplyState");
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
  .object({
    id: z.uuid(),
    name: z.string(),
    color: contactListColorSchema,
    /** Put there by the background classifier, not by a person or a bot. */
    addedAutomatically: z.boolean(),
  })
  .openapi("ContactListRef");

export const contactKnownBySchema = personSchema
  .extend({
    interactionCount: z.int(),
    lastInteractionAt: dateTimeSchema.nullable(),
  })
  .openapi("ContactKnownBy");

export const contactScoreSchema = z
  .object({
    familiarity: z.int().min(0).max(100).openapi({
      description:
        "How well the reader knows them, 0–100, from the reader's own interactions: how many, whether they answer, meetings, how recent.",
    }),
    importance: z.int().min(0).max(100).nullable().openapi({
      description:
        "How much they matter to the reader, 0–100; null until judged.",
    }),
    importanceSource: z.enum(["JEV", "SOKO_BOT", "MANUAL"]).nullable(),
    importanceReason: z.string().nullable().openapi({
      description:
        "Why Jev judged it so, as comma-separated keys: decides, value, active, close, or noise.",
    }),
  })
  .openapi("ContactScore");

export const contactSchema = z
  .object({
    id: z.uuid(),
    /** The reader's own scores; null for someone they never met. */
    score: z.union([contactScoreSchema, z.null()]),
    name: z.string(),
    organization: z.string().nullable(),
    role: z.string().nullable(),
    location: z.string().nullable(),
    summary: z.string().nullable(),
    whyInteresting: z.string().nullable(),
    stage: contactStageSchema,
    kind: contactKindSchema,
    nextStep: z.string().nullable(),
    followUpAt: calendarDateSchema
      .nullable()
      .openapi({ example: "2026-11-02" }),
    avatarUrl: z.string().nullable(),
    customFields: z.record(z.string(), z.unknown()),
    firstContactAt: dateTimeSchema.nullable(),
    lastContactAt: dateTimeSchema.nullable(),
    interactionCount: z.int(),
    lastInboundAt: dateTimeSchema.nullable(),
    awaitingReplySince: dateTimeSchema.nullable(),
    replyState: z.union([contactReplyStateSchema, z.null()]).openapi({
      description:
        "Where the latest outreach stands: AWAITING_REPLY for a week, then NO_REPLY; IN_CONVERSATION when they wrote or met within 30 days, REPLIED before that; null without directed interactions.",
    }),
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
    createdAutomatically: z.boolean(),
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
export const contactOrganizationSchema = z
  .object({
    name: z.string().openapi({ example: "Cardano Foundation" }),
    count: z.int().openapi({ example: 61, description: "Live contacts" }),
  })
  .openapi("ContactOrganization");

export const contactListQuerySchema = cursorPaginationQuerySchema.extend({
  cursor: z.uuid().optional(),
  search: z.string().trim().min(1).max(200).optional(),
  company: z.string().trim().min(1).max(200).optional().openapi({
    description:
      "Only people at the company this name belongs to: any spelling of it, and colleagues on the same company email domain. Names come from `GET /contacts/organizations`.",
  }),
  stage: contactStageSchema.optional(),
  kind: contactKindSchema.optional(),
  replyState: contactReplyStateSchema.optional(),
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
