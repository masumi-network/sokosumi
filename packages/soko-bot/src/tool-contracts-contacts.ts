import {
  CONTACT_LIST_COLORS,
  CONTACT_SORT_FIELDS,
  CONTACT_STAGES,
  contactChannelInputSchema,
  contactFieldsSchema,
  contactFilterSchema,
} from "@sokosumi/utils";
import { z } from "zod";

/** Extra contact fields a search may return besides the compact default. */
export const SOKO_BOT_CONTACT_EXTRA_FIELDS = [
  "summary",
  "whyInteresting",
  "nextStep",
  "followUpAt",
  "knownBy",
  "score",
  "channelDetails",
  "customFields",
  "avatarUrl",
  "firstContactAt",
  "createdAt",
] as const;

/** What a contact search ranks by, when `query` is given. */
export const contactQuerySchema = {
  /** Ranked search over everything about a contact, typos and meaning included. */
  query: z.string().trim().min(1).max(300).optional(),
  mode: z.enum(["both", "words", "meaning"]).default("both"),
};

/** People at this company by any spelling, from `search_companies`. */
export const companyNameSchema = z.string().trim().min(1).max(200).optional();

export const sokoBotSearchContactsInputSchema = contactFilterSchema
  .extend({
    ...contactQuerySchema,
    company: companyNameSchema,
    /** A manual or smart list from `list_contact_lists`. */
    listId: z.uuid().optional(),
    archived: z.boolean().optional(),
    sort: z.enum(CONTACT_SORT_FIELDS).default("lastContactAt"),
    direction: z.enum(["asc", "desc"]).optional(),
    cursor: z.uuid().optional(),
    limit: z.int().min(1).max(100).default(25),
    fields: z.array(z.enum(SOKO_BOT_CONTACT_EXTRA_FIELDS)).max(11).optional(),
  })
  .strict();

export const SOKO_BOT_CONTACT_BREAKDOWNS = [
  "stage",
  "kind",
  "organization",
  "location",
  "role",
  "list",
  "knownBy",
  "channel",
  "source",
  "lastContact",
] as const;

export const sokoBotCountContactsInputSchema = contactFilterSchema
  .extend({
    ...contactQuerySchema,
    company: companyNameSchema,
    listId: z.uuid().optional(),
    by: z.enum(SOKO_BOT_CONTACT_BREAKDOWNS).optional(),
    top: z.int().min(1).max(100).default(20),
  })
  .strict();

/** Which contacts a bulk change or export covers: the search's own filters. */
export const contactSetSchema = contactFilterSchema.extend({
  ...contactQuerySchema,
  company: companyNameSchema,
  listId: z.uuid().optional(),
  /** Archived contacts instead of live ones, e.g. to restore them. */
  archived: z.boolean().optional(),
});

export const sokoBotBulkUpdateContactsInputSchema = contactSetSchema
  .extend({
    change: z
      .object({
        stage: z.enum(CONTACT_STAGES).optional(),
        nextStep: z.string().trim().max(500).nullable().optional(),
        /** YYYY-MM-DD; null clears it. */
        followUpAt: z.iso.date().nullable().optional(),
        /** A manual list from `list_contact_lists`. */
        addToListId: z.uuid().optional(),
        removeFromListId: z.uuid().optional(),
        archived: z.boolean().optional(),
      })
      .strict(),
    /** Without it, nothing changes: you get the count and a sample to check. */
    confirm: z.boolean().default(false),
  })
  .strict();

export const sokoBotExportContactsInputSchema = contactSetSchema
  .extend({
    title: z.string().trim().min(1).max(160),
    /** Rows to write, best matches or most recent contact first. */
    limit: z.int().min(1).max(1_000).default(500),
    taskId: z.string().max(200).optional(),
  })
  .strict();

export const sokoBotSearchCompaniesInputSchema = z
  .object({
    /** Any spelling of the name, or part of the domain. */
    search: z.string().trim().min(1).max(200).optional(),
    industry: z.string().trim().min(1).max(200).optional(),
    minPeople: z.int().min(1).max(100_000).optional(),
    sort: z.enum(["people", "lastContact", "name"]).default("people"),
    offset: z.int().min(0).max(1_000_000).default(0),
    limit: z.int().min(1).max(100).default(25),
  })
  .strict();

export const sokoBotCompanyIdInputSchema = z
  .object({ companyId: z.uuid() })
  .strict();

export const sokoBotUpdateCompanyInputSchema = z
  .object({
    companyId: z.uuid(),
    /** From the company you read last; a newer one is a conflict: read again. */
    version: z.int().positive(),
    name: z.string().trim().min(1).max(200).optional(),
    website: z.string().trim().max(500).nullable().optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    industry: z.string().trim().max(200).nullable().optional(),
    size: z.string().trim().max(100).nullable().optional(),
    headquarters: z.string().trim().max(200).nullable().optional(),
    linkedinUrl: z.string().trim().max(500).nullable().optional(),
    whyItMatters: z.string().trim().max(1_000).nullable().optional(),
  })
  .strict();

export const sokoBotContactIdInputSchema = z
  .object({ contactId: z.uuid() })
  .strict();

export const sokoBotUpdateContactInputSchema = contactFieldsSchema
  .partial()
  .extend({
    contactId: z.uuid(),
    /** From the contact you read last; a newer one is a conflict: read again. */
    version: z.int().positive(),
    addChannels: z.array(contactChannelInputSchema).max(20).optional(),
    removeChannelIds: z.array(z.uuid()).max(20).optional(),
    archived: z.boolean().optional(),
    /**
     * How much this person matters to your owner, 0–100 (personal: their
     * teammates keep their own). Null hands it back to Jev's judgement.
     */
    importance: z.int().min(0).max(100).nullable().optional(),
  })
  .strict();

export const projectBriefingSchema = z.string().trim().max(20_000);

export const projectWebsiteSchema = z
  .url({ protocol: /^https?$/ })
  .max(2048)
  .describe("The project's website, http or https");

export const sokoBotFindIntegrationsInputSchema = z
  .object({ query: z.string().trim().min(1).max(100) })
  .strict();

export const sokoBotCreateProjectInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    briefing: projectBriefingSchema.optional(),
    websiteUrl: projectWebsiteSchema.optional(),
  })
  .strict();

export const sokoBotUpdateProjectInputSchema = z
  .object({
    projectId: z.uuid(),
    name: z.string().trim().min(1).max(200).optional(),
    /** Replaces the whole briefing; null clears it. */
    briefing: projectBriefingSchema.nullable().optional(),
    websiteUrl: projectWebsiteSchema.nullable().optional(),
  })
  .strict()
  .refine(
    ({ name, briefing, websiteUrl }) =>
      name !== undefined || briefing !== undefined || websiteUrl !== undefined,
    { message: "Give name, briefing or websiteUrl to change" },
  );

export const sokoBotFindPeopleInputSchema = z.object({
  listId: z.uuid(),
  /** 1 looks for one particular person; 10 or 25 for people who fit the list. */
  size: z.union([z.literal(1), z.literal(10), z.literal(25)]),
  brief: z.string().trim().min(1).max(1_000).optional(),
  /** Narrows this one search without changing the list's description. */
  focus: z.string().trim().min(1).max(300).optional(),
});

export const sokoBotEnrichContactInputSchema = z.object({
  contactId: z.uuid(),
});

export const sokoBotManageContactListsInputSchema = z
  .object({
    action: z.enum(["create", "update", "delete", "add", "remove"]),
    /** Every action but create. */
    listId: z.uuid().optional(),
    name: z.string().trim().min(1).max(80).optional(),
    color: z.enum(CONTACT_LIST_COLORS).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    /** Makes it a smart list that fills itself; null turns it manual. */
    smartFilter: contactFilterSchema.nullable().optional(),
    /** For add and remove: at most 500 contact ids. */
    contactIds: z.array(z.uuid()).min(1).max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const missing = (field: string) =>
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field} is required for ${value.action}`,
      });
    if (value.action === "create" && !value.name) missing("name");
    if (value.action !== "create" && !value.listId) missing("listId");
    if (
      (value.action === "add" || value.action === "remove") &&
      !value.contactIds
    )
      missing("contactIds");
  });
