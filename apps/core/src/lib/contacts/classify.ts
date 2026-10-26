/**
 * The rules around the background classifier: which names are not a
 * person's, what the model may change on a contact, which lists a contact
 * joins, and when a new list is worth creating. Pure, so every rule is
 * tested without a model.
 */
import type { CONTACT_KINDS, CONTACT_STAGES } from "@sokosumi/utils";

type ContactKind = (typeof CONTACT_KINDS)[number];
type ContactStage = (typeof CONTACT_STAGES)[number];

/** Words that name a place, a team or an inbox rather than a person. */
const NON_PERSON_WORDS = new Set([
  "praxis",
  "arztpraxis",
  "zahnarztpraxis",
  "ordination",
  "kanzlei",
  "büro",
  "buero",
  "office",
  "team",
  "info",
  "information",
  "support",
  "service",
  "kundenservice",
  "kundendienst",
  "customer",
  "kontakt",
  "contact",
  "sales",
  "vertrieb",
  "empfang",
  "reception",
  "rezeption",
  "verwaltung",
  "administration",
  "admin",
  "buchhaltung",
  "accounting",
  "billing",
  "rechnung",
  "rechnungswesen",
  "personal",
  "hr",
  "recruiting",
  "marketing",
  "presse",
  "press",
  "redaktion",
  "newsroom",
  "helpdesk",
  "zentrale",
  "sekretariat",
  "secretariat",
  "hello",
  "hallo",
  "klinik",
  "clinic",
  "apotheke",
  "pharmacy",
  "agentur",
  "agency",
  "studio",
  "hotel",
  "restaurant",
  "shop",
  "store",
  "bank",
  "versicherung",
  "insurance",
  "immobilien",
  "hausverwaltung",
  "schule",
  "school",
  "verein",
  "stiftung",
  "foundation",
  "gemeinde",
  "stadt",
]);

const LEGAL_FORM =
  /(^|\s)(gmbh|ag|se|inc\.?|ltd\.?|llc|ug|kg|ohg|gbr|e\.\s?v\.?|ev|s\.a\.?|sa|sarl|sas|bv|b\.v\.|nv|plc|corp\.?|co\.|company|group|holding|gruppe)(\s|$|,)/i;

/**
 * Whether a display name is clearly not a person's: a single place or team
 * word ("Praxis", "Office", "Team Acme"), or a company with a legal form
 * ("Northwind GmbH"). Plain first names stay people.
 */
export function isNonPersonName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes("@")) return false;
  if (LEGAL_FORM.test(trimmed)) return true;
  const first = trimmed.split(/[\s,·|–-]+/)[0]?.toLowerCase() ?? "";
  return NON_PERSON_WORDS.has(first);
}

/** Relationships the classifier may set; the sales steps are the team's call. */
export const CLASSIFIER_STAGES = [
  "CUSTOMER",
  "PARTNER",
  "INVESTOR",
  "VENDOR",
  "ADVISOR",
  "COMMUNITY",
  "PRESS",
] as const satisfies readonly ContactStage[];

export interface ClassificationAnswer {
  kind?: ContactKind | null;
  name?: string | null;
  stage?: string | null;
}

export interface ClassifiedContact {
  name: string;
  kind: ContactKind;
  stage: ContactStage;
  /** A person (not a Soko Bot or capture) created it, so its name was typed. */
  createdByPerson: boolean;
  /** Fields a person changed by hand; the classifier leaves those alone. */
  personEdited: ReadonlySet<string>;
  /** Whether the name is only what an address gave it. */
  placeholderName: boolean;
}

/**
 * What the classifier's answer may change: the kind, a better name when the
 * current one is a placeholder or not a person's, and a relationship when
 * the contact still has the default. Never what a person typed or changed.
 */
export function classificationChanges(
  contact: ClassifiedContact,
  answer: ClassificationAnswer,
): { kind?: ContactKind; name?: string; stage?: ContactStage } {
  if (contact.createdByPerson) return {};
  const changes: { kind?: ContactKind; name?: string; stage?: ContactStage } =
    {};
  if (
    answer.kind &&
    answer.kind !== contact.kind &&
    !contact.personEdited.has("kind")
  )
    changes.kind = answer.kind;
  const name = answer.name?.trim();
  const kind = changes.kind ?? contact.kind;
  if (
    name &&
    name.length <= 200 &&
    !name.includes("@") &&
    name !== contact.name &&
    !contact.personEdited.has("name") &&
    (contact.placeholderName ||
      contact.name.includes("@") ||
      isNonPersonName(contact.name)) &&
    (kind === "ORGANIZATION" || !isNonPersonName(name))
  )
    changes.name = name;
  const stage = CLASSIFIER_STAGES.find((value) => value === answer.stage);
  if (
    stage &&
    contact.stage === "CONTACT" &&
    !contact.personEdited.has("stage")
  )
    changes.stage = stage;
  return changes;
}

/** Jev must be this sure before a contact joins a list on its own. */
export const LIST_MEMBERSHIP_THRESHOLD = 0.8;
/** The most lists one classification adds a contact to. */
export const MAX_AUTO_LISTS_PER_CONTACT = 2;

export interface ListCandidate {
  id: string;
  /** Only manual lists take members; smart lists fill themselves. */
  smart: boolean;
}

/**
 * The lists a contact joins: manual ones it is not on yet, where Jev's
 * probability clears the threshold, most certain first.
 */
export function pickListMemberships(
  probabilities: ReadonlyMap<string, number>,
  lists: readonly ListCandidate[],
  memberOf: ReadonlySet<string>,
): string[] {
  return lists
    .filter((list) => !list.smart && !memberOf.has(list.id))
    .map((list) => ({ id: list.id, p: probabilities.get(list.id) ?? 0 }))
    .filter((entry) => entry.p >= LIST_MEMBERSHIP_THRESHOLD)
    .sort((a, b) => b.p - a.p)
    .slice(0, MAX_AUTO_LISTS_PER_CONTACT)
    .map((entry) => entry.id);
}

/** A new list needs at least this many fitting contacts. */
export const MIN_AUTO_LIST_MEMBERS = 3;
/** Lists the classifier may create per workspace in a day. */
export const MAX_AUTO_LISTS_PER_DAY = 1;

const STOP_WORDS = new Set(["the", "and", "of", "for", "der", "die", "das"]);

function listWords(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !STOP_WORDS.has(word))
    .map(singular);
}

function singular(word: string): string {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ss") || !word.endsWith("s")) return word;
  return word.slice(0, -1);
}

/**
 * Whether `name` is close to an existing list: the same words in any case
 * or number ("Investor" and "investors"), one name inside the other, or
 * most words shared. Meaning beyond that is the model's job.
 */
export function similarListName(
  name: string,
  existing: readonly string[],
): string | null {
  const words = listWords(name);
  if (words.length === 0) return null;
  for (const other of existing) {
    const otherWords = listWords(other);
    if (otherWords.length === 0) continue;
    const joined = words.join(" ");
    const otherJoined = otherWords.join(" ");
    if (
      joined === otherJoined ||
      ` ${otherJoined} `.includes(` ${joined} `) ||
      ` ${joined} `.includes(` ${otherJoined} `)
    )
      return other;
    const shared = words.filter((word) => otherWords.includes(word)).length;
    if (shared / new Set([...words, ...otherWords]).size >= 0.5) return other;
  }
  return null;
}

export interface ListProposal {
  name: string;
  description: string | null;
  memberIds: string[];
}

export type ProposalVerdict =
  | { ok: true; proposal: ListProposal }
  | {
      ok: false;
      reason: "too_few_members" | "similar_list" | "daily_cap" | "bad_name";
    };

/**
 * Whether a proposed list may be created: a sensible name, enough distinct
 * known contacts, nothing similar already there, and the day's cap not used.
 */
export function checkListProposal(
  proposal: ListProposal,
  context: {
    existingNames: readonly string[];
    candidateIds: ReadonlySet<string>;
    createdToday: number;
  },
): ProposalVerdict {
  if (context.createdToday >= MAX_AUTO_LISTS_PER_DAY)
    return { ok: false, reason: "daily_cap" };
  const name = proposal.name.trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 60 || /[@<>{}]/.test(name))
    return { ok: false, reason: "bad_name" };
  if (similarListName(name, context.existingNames))
    return { ok: false, reason: "similar_list" };
  const memberIds = [...new Set(proposal.memberIds)].filter((id) =>
    context.candidateIds.has(id),
  );
  if (memberIds.length < MIN_AUTO_LIST_MEMBERS)
    return { ok: false, reason: "too_few_members" };
  return {
    ok: true,
    proposal: {
      name,
      description: proposal.description?.trim().slice(0, 500) || null,
      memberIds,
    },
  };
}
