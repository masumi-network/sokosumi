import { z } from "zod";

/**
 * What a contact is to the team. `CONTACT` is the plain default; the sales
 * steps (prospect, lead, active, customer) apply only to people the team
 * sells to; the rest name the relationship; `DORMANT` is gone quiet.
 */
export const CONTACT_STAGES = [
  "CONTACT",
  "PROSPECT",
  "LEAD",
  "ACTIVE",
  "CUSTOMER",
  "PARTNER",
  "INVESTOR",
  "VENDOR",
  "ADVISOR",
  "COMMUNITY",
  "PRESS",
  "FRIEND",
  "DORMANT",
] as const;

/** A person, or an organization or shared inbox (a practice, `info@`). */
export const CONTACT_KINDS = ["PERSON", "ORGANIZATION"] as const;

/**
 * Where the latest outreach stands, from the interactions' directions:
 * waiting for an answer, unanswered for `CONTACT_REPLY_WAIT_DAYS`, talking
 * (they answered within `CONTACT_CONVERSATION_DAYS`), or answered before.
 */
export const CONTACT_REPLY_STATES = [
  "AWAITING_REPLY",
  "NO_REPLY",
  "IN_CONVERSATION",
  "REPLIED",
] as const;

export const CONTACT_REPLY_WAIT_DAYS = 7;
export const CONTACT_CONVERSATION_DAYS = 30;

export const CONTACT_CHANNEL_TYPES = [
  "EMAIL",
  "PHONE",
  "SLACK",
  "LINKEDIN",
  "X",
  "WEBSITE",
  "TELEGRAM",
  "WHATSAPP",
  "GITHUB",
  "OTHER",
] as const;

export const CONTACT_CHANNEL_SOURCES = [
  "MANUAL",
  "EMAIL",
  "CALENDAR",
  "SLACK",
  "WEB_RESEARCH",
  "IMPORT",
  "OTHER",
] as const;

export const CONTACT_INTERACTION_CHANNELS = [
  "EMAIL",
  "MEETING",
  "SLACK",
  "CALL",
  "MANUAL",
  "OTHER",
] as const;

export const CONTACT_INTERACTION_DIRECTIONS = ["IN", "OUT", "BOTH"] as const;

/** Palette tokens a list can wear; Web maps each to a semantic color. */
export const CONTACT_LIST_COLORS = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "violet",
  "pink",
] as const;

export const CONTACT_SORT_FIELDS = [
  "name",
  "organization",
  "stage",
  "lastContactAt",
  "firstContactAt",
  "createdAt",
  "updatedAt",
  /** The reader's own scores; see `contact_score`. */
  "familiarity",
  "importance",
] as const;

export type ContactChannelType = (typeof CONTACT_CHANNEL_TYPES)[number];

function stripPrefix(value: string, pattern: RegExp): string {
  return value.replace(pattern, "");
}

/** `https://www.x.com/Foo/` → `x.com/Foo` (host lowercased, no www or slash). */
function hostAndPath(raw: string): { host: string; path: string } | null {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".")) return null;
    return { host, path: url.pathname.replace(/\/+$/, "") };
  } catch {
    return null;
  }
}

/** A handle typed as `@name`, `name` or a profile URL on one of `hosts`. */
function handle(raw: string, hosts: readonly string[]): string | null {
  const value = raw.trim();
  const page = /[./]/.test(value) ? hostAndPath(value) : null;
  const name = page
    ? hosts.includes(page.host)
      ? (page.path.split("/").filter(Boolean)[0] ?? "")
      : ""
    : stripPrefix(value, /^@/);
  const cleaned = name.toLowerCase();
  return /^[a-z0-9_.-]{1,100}$/.test(cleaned) ? cleaned : null;
}

/** E.164 when the number says its country (`+` or `00`), digits otherwise. */
function phone(raw: string): string | null {
  const value = stripPrefix(raw.trim(), /^(tel:|https?:\/\/wa\.me\/)/i);
  const international = /^\s*(\+|00)/.test(value);
  const digits = value.replace(/\D/g, "");
  const national =
    international && value.trim().startsWith("00") ? digits.slice(2) : digits;
  if (international && /^[1-9]\d{6,14}$/.test(national)) return `+${national}`;
  return digits.length >= 5 && digits.length <= 20 ? digits : null;
}

function linkedIn(raw: string): string | null {
  const value = raw.trim();
  const page = /[./]/.test(value) ? hostAndPath(value) : null;
  if (page && !/(^|\.)linkedin\.com$/.test(page.host)) return null;
  const parts = page
    ? page.path.split("/").filter(Boolean)
    : ["in", stripPrefix(value, /^@/)];
  const [kind, slug] = parts;
  if (!kind || !slug || !["in", "company", "school"].includes(kind))
    return null;
  const cleaned = decodeURIComponent(slug).toLowerCase();
  return /^[\p{L}\p{N}_.-]{1,100}$/u.test(cleaned)
    ? `https://www.linkedin.com/${kind}/${cleaned}`
    : null;
}

function website(raw: string): string | null {
  const page = hostAndPath(raw.trim());
  return page ? `https://${page.host}${page.path}` : null;
}

/**
 * The one form Core stores for a channel, so the same address typed twice
 * (case, `mailto:`, `www.`, a trailing slash, phone spacing) is one channel.
 * `null` when the value is not a usable address of that type.
 */
export function normalizeContactChannelValue(
  type: ContactChannelType,
  raw: string,
): string | null {
  const value = raw.trim();
  if (!value) return null;
  switch (type) {
    case "EMAIL": {
      const email = stripPrefix(value, /^mailto:/i).toLowerCase();
      return email.length <= 320 && z.email().safeParse(email).success
        ? email
        : null;
    }
    case "PHONE":
    case "WHATSAPP":
      return phone(value);
    case "SLACK": {
      const slack = value.toUpperCase();
      return /^[A-Z0-9]+:[A-Z0-9]+$/.test(slack) ? slack : null;
    }
    case "LINKEDIN":
      return linkedIn(value);
    case "X":
      return handle(value, ["x.com", "twitter.com", "mobile.twitter.com"]);
    case "GITHUB":
      return handle(value, ["github.com"]);
    case "TELEGRAM":
      return handle(value, ["t.me", "telegram.me"]);
    case "WEBSITE":
      return website(value);
    case "OTHER":
      return value.slice(0, 500);
  }
}

/** A name to file a contact under when only an address is known. */
export function contactNameFromChannel(
  type: ContactChannelType,
  value: string,
): string {
  if (type === "EMAIL") {
    // `jane.doe@` → "Jane Doe", `federico@` → "Federico"; anything else
    // (`lopezfacundo123@`, a hash) stays the address until a real name arrives.
    const local = (value.split("@")[0] ?? "").split("+")[0] ?? "";
    const parts = local.split(/[._-]+/);
    const letters = (part: string) => /^\p{L}+$/u.test(part);
    const readable =
      (parts.length >= 2 &&
        parts.length <= 4 &&
        parts.every(letters) &&
        parts.some((part) => part.length >= 2)) ||
      (parts.length === 1 &&
        letters(local) &&
        local.length >= 3 &&
        local.length <= 12);
    return readable
      ? parts
          .map(
            (part) =>
              part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
          )
          .join(" ")
      : value;
  }
  if (type === "LINKEDIN") return value.split("/").pop() ?? value;
  return value;
}

const httpUrlSchema = z
  .url()
  .max(2000)
  .refine((value) => /^https?:\/\//.test(value), "Use an HTTP or HTTPS URL");

/**
 * A `YYYY-MM-DD` calendar day. Not `z.iso.date()`: that is `format: date` in
 * the OpenAPI document, which the generated client reads as a Date and sends
 * back as a timestamp.
 */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((date) => z.iso.date().safeParse(date).success, {
    message: "Not a calendar date",
  });

function optionalText(max: number) {
  return z.string().trim().max(max).nullable().optional();
}

export const contactChannelInputSchema = z.object({
  type: z.enum(CONTACT_CHANNEL_TYPES),
  value: z.string().trim().min(1).max(500),
  label: optionalText(80),
  isPrimary: z.boolean().optional(),
  source: z.enum(CONTACT_CHANNEL_SOURCES).optional(),
  /** Where the address was found, for channels a bot researched. */
  sourceUrl: httpUrlSchema.nullable().optional(),
  verified: z.boolean().optional(),
});

const customFieldValueSchema = z.union([
  z.string().max(2000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const contactFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  organization: optionalText(200),
  role: optionalText(200),
  location: optionalText(200),
  summary: optionalText(4000),
  whyInteresting: optionalText(2000),
  stage: z.enum(CONTACT_STAGES).optional(),
  kind: z.enum(CONTACT_KINDS).optional(),
  nextStep: optionalText(500),
  /** Calendar date, `YYYY-MM-DD`. */
  followUpAt: calendarDateSchema.nullable().optional(),
  avatarUrl: httpUrlSchema.nullable().optional(),
  customFields: z
    .record(z.string().trim().min(1).max(100), customFieldValueSchema)
    .refine(
      (fields) => Object.keys(fields).length <= 50,
      "At most 50 custom fields",
    )
    .optional(),
});

export const createContactSchema = contactFieldsSchema
  .extend({
    name: contactFieldsSchema.shape.name.optional(),
    channels: z.array(contactChannelInputSchema).max(20).default([]),
    /** Attach to the contact that already owns one of these channels. */
    upsert: z.boolean().default(false),
  })
  .refine(
    (value) => Boolean(value.name) || value.channels.length > 0,
    "A contact needs a name or a channel",
  );

export const updateContactSchema = contactFieldsSchema.partial().extend({
  version: z.int().positive(),
});

export const contactInteractionInputSchema = z.object({
  occurredAt: z.iso.datetime({ offset: true }),
  channel: z.enum(CONTACT_INTERACTION_CHANNELS),
  direction: z.enum(CONTACT_INTERACTION_DIRECTIONS).nullable().optional(),
  /** One line: what it was about. */
  summary: z.string().trim().min(1).max(300),
  /** Provider message or event id; the same one twice is one interaction. */
  sourceRef: z.string().trim().min(1).max(500).nullable().optional(),
  sourceUrl: httpUrlSchema.nullable().optional(),
});

/** A contact filter: the list query and a smart list's saved definition. */
export const contactFilterSchema = z
  .object({
    /** Name, organization or any channel value. */
    search: z.string().trim().min(1).max(200).optional(),
    stages: z
      .array(z.enum(CONTACT_STAGES))
      .min(1)
      .max(CONTACT_STAGES.length)
      .optional(),
    kind: z.enum(CONTACT_KINDS).optional(),
    /** Where the latest outreach stands; see `CONTACT_REPLY_STATES`. */
    replyStates: z
      .array(z.enum(CONTACT_REPLY_STATES))
      .min(1)
      .max(CONTACT_REPLY_STATES.length)
      .optional(),
    /** On any of these manual lists. */
    listIds: z.array(z.uuid()).min(1).max(20).optional(),
    knownByUserId: z.string().min(1).max(200).optional(),
    /** Someone the reader has had an interaction with. */
    knownByMe: z.boolean().optional(),
    lastContactAfter: z.iso.datetime({ offset: true }).optional(),
    lastContactBefore: z.iso.datetime({ offset: true }).optional(),
    /** Contacted before, but not in this many days. */
    lastContactOlderThanDays: z.int().min(1).max(3650).optional(),
    createdWithinDays: z.int().min(1).max(3650).optional(),
    /** Follow-up date today or earlier. */
    followUpDue: z.boolean().optional(),
    hasChannel: z.enum(CONTACT_CHANNEL_TYPES).optional(),
    hasInteractions: z.boolean().optional(),
  })
  .strict();

export type ContactFilter = z.infer<typeof contactFilterSchema>;

export const contactListInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.enum(CONTACT_LIST_COLORS).default("gray"),
  description: optionalText(500),
  /** Omit or null for a manual list; a filter makes it a smart list. */
  smartFilter: contactFilterSchema.nullable().optional(),
});

export const contactListUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  color: z.enum(CONTACT_LIST_COLORS).optional(),
  description: optionalText(500),
  smartFilter: contactFilterSchema.nullable().optional(),
});

export const contactListMembersSchema = z
  .object({
    add: z.array(z.uuid()).max(500).default([]),
    remove: z.array(z.uuid()).max(500).default([]),
  })
  .refine(
    (value) => value.add.length + value.remove.length > 0,
    "Add or remove at least one contact",
  );

export const mergeContactsSchema = z
  .object({
    winnerId: z.uuid(),
    loserIds: z.array(z.uuid()).min(1).max(20),
  })
  .refine(
    (value) => !value.loserIds.includes(value.winnerId),
    "A contact cannot be merged into itself",
  );

const columnRefSchema = z.string().trim().min(1).max(200);

/** Contact field → table column (id or name) for an import. */
export const contactImportMappingSchema = z
  .object({
    name: columnRefSchema,
    organization: columnRefSchema.optional(),
    role: columnRefSchema.optional(),
    location: columnRefSchema.optional(),
    summary: columnRefSchema.optional(),
    whyInteresting: columnRefSchema.optional(),
    nextStep: columnRefSchema.optional(),
    /** A date column; becomes the first interaction. */
    firstContactAt: columnRefSchema.optional(),
    email: columnRefSchema.optional(),
    phone: columnRefSchema.optional(),
    linkedin: columnRefSchema.optional(),
    x: columnRefSchema.optional(),
    website: columnRefSchema.optional(),
    github: columnRefSchema.optional(),
    telegram: columnRefSchema.optional(),
    /** Each value (or each option of a multi-select) becomes a manual list. */
    lists: columnRefSchema.optional(),
  })
  .strict();

export const contactImportSchema = z.object({
  tableId: z.uuid(),
  mapping: contactImportMappingSchema,
});
