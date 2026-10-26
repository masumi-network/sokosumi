import type {
  ContactChannel,
  ContactChannelType,
  ContactKind,
  ContactListColor,
  ContactReplyState,
  ContactStage,
} from "@sokosumi/core-client";
import type { ContactQuery } from "@/lib/services/contacts.client";
import { isUuidString } from "@/lib/utils/uuid";

/** The smart presets at the top of the rail, as list query params (design.md). */
export const CONTACT_PRESETS = {
  all: {},
  mine: { knownByMe: "true" },
  recent: { createdWithinDays: 14 },
} satisfies Record<string, Partial<ContactQuery>>;

export type ContactPreset = keyof typeof CONTACT_PRESETS;

export const CONTACT_PRESET_IDS = Object.keys(
  CONTACT_PRESETS,
) as ContactPreset[];

export function isContactPreset(value: string): value is ContactPreset {
  return value in CONTACT_PRESETS;
}

export const CONTACT_SORTS = [
  "name",
  "organization",
  "stage",
  "lastContactAt",
  "firstContactAt",
  "createdAt",
  "updatedAt",
  "familiarity",
  "importance",
] as const satisfies readonly ContactQuery["sort"][];

export type ContactSort = (typeof CONTACT_SORTS)[number];

/** What the rail, toolbar and URL say about which contacts to show. */
export interface ContactView {
  /** A preset id, or a list's id. */
  view: string;
  /** People at this company only, by any spelling or its email domain. */
  company: string | null;
  search: string;
  stage: ContactStage | null;
  replyState: ContactReplyState | null;
  kind: ContactKind | null;
  /** `me` or a member's user id. */
  knownBy: string | null;
  sort: ContactSort;
  direction: "asc" | "desc";
}

/** The `GET /contacts` query for a view; a toolbar filter narrows its preset. */
export function contactQuery(view: ContactView): ContactQuery {
  // A view that is neither a preset nor a list id, like a link to a removed
  // tab, shows everyone instead of failing.
  const preset = isContactPreset(view.view)
    ? CONTACT_PRESETS[view.view]
    : isUuidString(view.view)
      ? { listId: view.view }
      : {};
  const query: ContactQuery = { ...preset, sort: view.sort };
  query.direction = view.direction;
  const search = view.search.trim();
  if (search) query.search = search;
  if (view.company) query.company = view.company;
  if (view.stage) query.stage = view.stage;
  if (view.replyState) query.replyState = view.replyState;
  if (view.kind) query.kind = view.kind;
  if (view.knownBy === "me") query.knownByMe = "true";
  else if (view.knownBy) query.knownByUserId = view.knownBy;
  return query;
}

/** The rows Core's `search` would keep, judged on the client: name, organization or any channel value. */
export function matchesContactSearch(
  contact: {
    name: string;
    organization: string | null;
    channels: ContactChannel[];
  },
  search: string,
): boolean {
  const needle = search.trim().toLowerCase();
  return [
    contact.name,
    contact.organization,
    ...contact.channels.map((channel) => channel.value),
  ].some((value) => value?.toLowerCase().includes(needle));
}

/**
 * The importance a person picks from the menu, highest first. Jev's scores
 * fall between them; the menu shows the nearest.
 */
export const IMPORTANCE_LEVELS = [
  { id: "veryHigh", value: 90 },
  { id: "high", value: 70 },
  { id: "medium", value: 50 },
  { id: "low", value: 25 },
  { id: "minimal", value: 5 },
] as const;

export function nearestImportanceLevel(
  importance: number,
): (typeof IMPORTANCE_LEVELS)[number] {
  return IMPORTANCE_LEVELS.reduce((best, level) =>
    Math.abs(level.value - importance) < Math.abs(best.value - importance)
      ? level
      : best,
  );
}

/** Ascending reads naturally for text, newest-first for dates. */
export function defaultDirection(sort: ContactSort): "asc" | "desc" {
  return sort === "name" || sort === "organization" || sort === "stage"
    ? "asc"
    : "desc";
}

/** The dot a list wears in the rail, its chips and the dialog. */
export const LIST_COLOR_DOT: Record<ContactListColor, string> = {
  gray: "bg-muted-foreground",
  red: "bg-semantic-destructive",
  orange: "bg-chart-5",
  amber: "bg-chart-4",
  green: "bg-semantic-success",
  teal: "bg-chart-3",
  blue: "bg-chart-1",
  indigo: "bg-primary",
  violet: "bg-status-working",
  pink: "bg-chart-2",
};

/**
 * What a contact is to the team, grouped the way the menus show it: the plain
 * default, the sales steps, the other relationships, and gone quiet.
 */
export const STAGE_GROUPS = {
  general: ["CONTACT", "FRIEND"],
  sales: ["PROSPECT", "LEAD", "ACTIVE", "CUSTOMER"],
  relationships: [
    "PARTNER",
    "INVESTOR",
    "VENDOR",
    "ADVISOR",
    "COMMUNITY",
    "PRESS",
  ],
  status: ["DORMANT"],
} as const satisfies Record<string, readonly ContactStage[]>;

export type StageGroup = keyof typeof STAGE_GROUPS;

export const CONTACT_STAGES: ContactStage[] =
  Object.values(STAGE_GROUPS).flat();

/** Stage chips stay neutral; the dot carries the stage, the label says it. */
export const STAGE_DOT: Record<ContactStage, string> = {
  CONTACT: "bg-muted-foreground",
  FRIEND: "bg-status-done",
  PROSPECT: "bg-primary",
  LEAD: "bg-chart-4",
  ACTIVE: "bg-semantic-success",
  CUSTOMER: "bg-chart-1",
  PARTNER: "bg-chart-2",
  INVESTOR: "bg-status-working",
  VENDOR: "bg-chart-5",
  ADVISOR: "bg-chart-3",
  COMMUNITY: "bg-status-external",
  PRESS: "bg-semantic-warning",
  DORMANT: "bg-quaternary",
};

export const CONTACT_REPLY_STATES: ContactReplyState[] = [
  "NO_REPLY",
  "AWAITING_REPLY",
  "IN_CONVERSATION",
  "REPLIED",
];

/** Only the unanswered states call for attention. */
export const REPLY_DOT: Record<ContactReplyState, string> = {
  NO_REPLY: "bg-semantic-destructive",
  AWAITING_REPLY: "bg-semantic-warning",
  IN_CONVERSATION: "bg-semantic-success",
  REPLIED: "bg-muted-foreground",
};

export const CONTACT_KINDS: ContactKind[] = ["PERSON", "ORGANIZATION"];

/** Whole days between `since` and `now`, never negative. */
export function daysSince(since: Date | string, now: Date): number {
  return Math.max(
    0,
    Math.floor((now.getTime() - new Date(since).getTime()) / 86_400_000),
  );
}

/** The address a person writes to: the primary email, else the first one. */
export function primaryEmail(channels: ContactChannel[]): string | null {
  const emails = channels.filter((channel) => channel.type === "EMAIL");
  return (
    (emails.find((channel) => channel.isPrimary) ?? emails[0])?.value ?? null
  );
}

/** Channel order in a row and the panel: the most direct ways first. */
export const CHANNEL_ORDER: ContactChannelType[] = [
  "EMAIL",
  "PHONE",
  "SLACK",
  "LINKEDIN",
  "X",
  "WHATSAPP",
  "TELEGRAM",
  "GITHUB",
  "WEBSITE",
  "OTHER",
];

export function sortChannels(channels: ContactChannel[]): ContactChannel[] {
  return [...channels].sort(
    (a, b) =>
      CHANNEL_ORDER.indexOf(a.type) - CHANNEL_ORDER.indexOf(b.type) ||
      Number(b.isPrimary) - Number(a.isPrimary),
  );
}

/** Where a stored channel value opens, or null when it has no address to open. */
export function channelHref(
  channel: Pick<ContactChannel, "type" | "value">,
): string | null {
  const { type, value } = channel;
  switch (type) {
    case "EMAIL":
      return `mailto:${value}`;
    case "PHONE":
      return `tel:${value}`;
    case "WHATSAPP":
      return `https://wa.me/${value.replace(/\D/g, "")}`;
    case "X":
      return `https://x.com/${value}`;
    case "GITHUB":
      return `https://github.com/${value}`;
    case "TELEGRAM":
      return `https://t.me/${value}`;
    case "LINKEDIN":
    case "WEBSITE":
      return /^https?:\/\//.test(value) ? value : null;
    default:
      return null;
  }
}

/** A stored value as a person reads it. */
export function channelLabel(
  channel: Pick<ContactChannel, "type" | "value">,
): string {
  const { type, value } = channel;
  switch (type) {
    case "X":
    case "TELEGRAM":
      return `@${value}`;
    case "LINKEDIN":
      return value.replace(/^https:\/\/www\.linkedin\.com\//, "");
    case "WEBSITE":
      return value.replace(/^https?:\/\//, "");
    default:
      return value;
  }
}

/** One or two letters for an avatar. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? `${words[0][0]}${words[words.length - 1][0]}`
      : (words[0]?.slice(0, 1) ?? "?");
  return letters.toUpperCase();
}

/** `YYYY-MM-DD` of a follow-up before or on today, in the reader's time zone. */
export function isFollowUpDue(followUpAt: string | null, today: Date): boolean {
  if (!followUpAt) return false;
  const local = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  return followUpAt <= local;
}

/** A thrown Core error's stable kind and payload, from the client's parsed body. */
export function coreErrorOf(error: unknown): {
  kind?: string;
  message?: string;
  existingContactId?: string;
} {
  if (!error || typeof error !== "object") return {};
  const body = error as Record<string, unknown>;
  return {
    kind: typeof body.kind === "string" ? body.kind : undefined,
    message: typeof body.message === "string" ? body.message : undefined,
    existingContactId:
      typeof body.existingContactId === "string"
        ? body.existingContactId
        : undefined,
  };
}

/** Contact fields an import can fill, in the order the mapping step shows. */
export const IMPORT_FIELDS = [
  "name",
  "organization",
  "role",
  "location",
  "email",
  "phone",
  "linkedin",
  "x",
  "website",
  "github",
  "telegram",
  "summary",
  "whyInteresting",
  "nextStep",
  "firstContactAt",
  "lists",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

const IMPORT_ALIASES: Record<ImportField, string[]> = {
  name: ["name", "full name", "person", "contact"],
  organization: ["organization", "organisation", "company", "org"],
  role: ["role", "title", "job title", "position"],
  location: ["location", "city", "country"],
  email: ["email", "e-mail", "mail"],
  phone: ["phone", "mobile", "telephone"],
  linkedin: ["linkedin"],
  x: ["x", "twitter"],
  website: ["website", "url", "site", "homepage"],
  github: ["github"],
  telegram: ["telegram"],
  summary: ["summary", "about", "notes", "relationship"],
  whyInteresting: ["why interesting", "why"],
  nextStep: ["next step", "next"],
  firstContactAt: ["first contact", "met", "first met"],
  lists: ["tags", "lists", "list", "labels"],
};

/** A first guess at the mapping, from column names a person would use. */
export function guessImportMapping(
  columns: { id: string; name: string }[],
): Partial<Record<ImportField, string>> {
  const mapping: Partial<Record<ImportField, string>> = {};
  const used = new Set<string>();
  for (const field of IMPORT_FIELDS) {
    const match = columns.find(
      (column) =>
        !used.has(column.id) &&
        IMPORT_ALIASES[field].includes(column.name.trim().toLowerCase()),
    );
    if (match) {
      mapping[field] = match.id;
      used.add(match.id);
    }
  }
  return mapping;
}
