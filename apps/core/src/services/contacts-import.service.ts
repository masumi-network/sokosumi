import type { Prisma } from "@sokosumi/database";
import {
  CONTACT_LIST_COLORS,
  type ContactChannelType,
  type contactImportSchema,
  encodeTableCsv,
  normalizeContactChannelValue,
} from "@sokosumi/utils";
import type { z } from "zod";
import { notFound, unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { contactImportResultSchema } from "@/schemas/contact.schema";
import { ensureManualContactList } from "@/services/contact-lists.service";
import {
  allContacts,
  type ContactActor,
  type ListContactsOptions,
  logContactInteraction,
  upsertContact,
} from "@/services/contacts.service";

type Tx = Prisma.TransactionClient;
type ImportInput = z.infer<typeof contactImportSchema>;
type Mapping = ImportInput["mapping"];
type ImportResult = z.input<typeof contactImportResultSchema>;

/** An import reads at most this many rows of one table. */
const MAX_IMPORT_ROWS = 5_000;

const CHANNEL_COLUMNS = {
  email: "EMAIL",
  phone: "PHONE",
  linkedin: "LINKEDIN",
  x: "X",
  website: "WEBSITE",
  github: "GITHUB",
  telegram: "TELEGRAM",
} as const satisfies Partial<Record<keyof Mapping, ContactChannelType>>;

/** Text fields an import fills, with the API's length limit for each. */
const TEXT_FIELDS = {
  organization: 200,
  role: 200,
  location: 200,
  summary: 4000,
  whyInteresting: 2000,
  nextStep: 500,
} as const satisfies Partial<Record<keyof Mapping, number>>;

function text(value: unknown, max: number): string | null {
  if (value == null) return null;
  const result = (Array.isArray(value) ? value.join(", ") : String(value))
    .trim()
    .slice(0, max);
  return result || null;
}

/** A cell that may hold several values: a multi-select, or `a, b; c`. */
function values(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value.map(String)
    : typeof value === "string"
      ? value.split(/[,;\n]/)
      : value == null
        ? []
        : [String(value)];
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))];
}

function date(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const parsed = new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Column id for each mapped field; names match case-insensitively. */
function resolveColumns(
  columns: { id: string; name: string }[],
  mapping: Mapping,
): Partial<Record<keyof Mapping, string>> {
  const resolved: Partial<Record<keyof Mapping, string>> = {};
  for (const [field, ref] of Object.entries(mapping) as [
    keyof Mapping,
    string | undefined,
  ][]) {
    if (!ref) continue;
    const column =
      columns.find((candidate) => candidate.id === ref) ??
      columns.find(
        (candidate) => candidate.name.toLowerCase() === ref.toLowerCase(),
      );
    if (!column) throw unprocessableEntity(`No column "${ref}" in this table`);
    resolved[field] = column.id;
  }
  return resolved;
}

/** Contacts sharing this name exactly, when no channel identifies the row. */
async function contactByName(tx: Tx, actor: ContactActor, name: string) {
  return tx.contact.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      mergedIntoId: null,
      name: { equals: name, mode: "insensitive" },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
}

/**
 * Imports the rows of a Files table as contacts. Running it again changes
 * nothing: rows are matched by channel (then by name when a row has none),
 * only empty fields are filled, lists are joined once, and the first-contact
 * date is an interaction keyed by the row.
 */
export async function importContactsFromTable(
  actor: ContactActor,
  input: ImportInput,
): Promise<ImportResult> {
  const table = await prisma.dataTable.findFirst({
    where: {
      id: input.tableId,
      workspaceId: actor.workspaceId,
      archivedAt: null,
    },
    include: { columns: { select: { id: true, name: true } } },
  });
  if (!table) throw notFound("Table not found");
  const columns = resolveColumns(table.columns, input.mapping);
  const rows = await prisma.tableRow.findMany({
    where: { tableId: table.id, archivedAt: null },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: MAX_IMPORT_ROWS,
    select: { id: true, values: true },
  });
  const result: ImportResult = {
    rows: rows.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    listsCreated: 0,
    mergeSuggestions: [],
  };
  const listIds = new Map<string, string>();
  for (const row of rows) {
    const cells =
      row.values && typeof row.values === "object" && !Array.isArray(row.values)
        ? row.values
        : {};
    const cell = (field: keyof Mapping) => {
      const id = columns[field];
      return id ? cells[id] : undefined;
    };
    const channels = Object.entries(CHANNEL_COLUMNS).flatMap(([field, type]) =>
      values(cell(field as keyof Mapping))
        .filter((value) => normalizeContactChannelValue(type, value))
        .map((value) => ({ type, value, source: "IMPORT" as const })),
    );
    const name = text(cell("name"), 200);
    if (!name && !channels.length) {
      result.skipped += 1;
      continue;
    }
    const fields = Object.fromEntries(
      Object.entries(TEXT_FIELDS).map(([field, max]) => [
        field,
        text(cell(field as keyof Mapping), max),
      ]),
    );
    const outcome = await serializableTransaction(async (tx) => {
      const byName =
        !channels.length && name ? await contactByName(tx, actor, name) : null;
      const upserted = byName
        ? null
        : await upsertContact(
            tx,
            actor,
            { ...fields, name: name ?? undefined, channels, upsert: true },
            { defaultChannelSource: "IMPORT" },
          );
      const contactId = byName?.id ?? upserted?.contact.id;
      if (!contactId) return null;
      const firstContactAt = date(cell("firstContactAt"));
      let changed = upserted?.changed ?? false;
      if (firstContactAt) {
        const logged = await logContactInteraction(tx, actor, contactId, {
          occurredAt: firstContactAt.toISOString(),
          channel: "OTHER",
          summary: `First contact (imported from ${table.title})`,
          sourceRef: `import:${table.id}:${row.id}:first-contact`,
        });
        changed ||= logged.created;
      }
      let listsCreated = 0;
      for (const listName of values(cell("lists"))) {
        const key = listName.toLowerCase();
        let listId = listIds.get(key);
        if (!listId) {
          const list = await ensureManualContactList(
            tx,
            actor,
            listName.slice(0, 80),
            CONTACT_LIST_COLORS[listIds.size % CONTACT_LIST_COLORS.length] ??
              "gray",
          );
          listId = list.id;
          if (list.created) listsCreated += 1;
        }
        const joined = await tx.contactListMember.createMany({
          data: [
            {
              listId,
              contactId,
              addedByUserId: actor.userId,
              addedBySokoBotId: actor.sokoBotId,
            },
          ],
          skipDuplicates: true,
        });
        changed ||= joined.count > 0;
        listIds.set(key, listId);
      }
      return {
        created: upserted?.created ?? false,
        changed,
        listsCreated,
        mergeSuggestion: upserted?.mergeSuggestion ?? null,
      };
    }, "Contacts changed during the import; run it again");
    if (!outcome) {
      result.skipped += 1;
      continue;
    }
    result.listsCreated += outcome.listsCreated;
    if (outcome.mergeSuggestion)
      result.mergeSuggestions.push(outcome.mergeSuggestion);
    if (outcome.created) result.created += 1;
    else if (outcome.changed) result.updated += 1;
    else result.unchanged += 1;
  }
  return result;
}

const CSV_HEADER = [
  "Name",
  "Organization",
  "Role",
  "Stage",
  "Emails",
  "Phones",
  "LinkedIn",
  "X",
  "Website",
  "Other channels",
  "Lists",
  "Known by",
  "First contact",
  "Last contact",
  "Interactions",
  "Next step",
  "Follow-up",
  "Location",
  "Summary",
  "Why interesting",
  "Created",
  "Updated",
];

function isoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

/** The contacts a list query matches, as CSV (formula-safe). */
export async function exportContactsCsv(
  actor: ContactActor,
  options: Omit<ListContactsOptions, "cursor" | "limit">,
): Promise<string> {
  const contacts = await allContacts(actor, options);
  const channel = (
    contact: (typeof contacts)[number],
    types: readonly string[],
  ) =>
    contact.channels
      .filter((entry) => types.includes(entry.type))
      .map((entry) => entry.value);
  const known = new Set(["EMAIL", "PHONE", "LINKEDIN", "X", "WEBSITE"]);
  return encodeTableCsv([
    CSV_HEADER,
    ...contacts.map((contact) => [
      contact.name,
      contact.organization,
      contact.role,
      contact.stage,
      channel(contact, ["EMAIL"]),
      channel(contact, ["PHONE"]),
      channel(contact, ["LINKEDIN"]),
      channel(contact, ["X"]),
      channel(contact, ["WEBSITE"]),
      contact.channels
        .filter((entry) => !known.has(entry.type))
        .map((entry) => `${entry.type.toLowerCase()}: ${entry.value}`),
      contact.lists.map((list) => list.name),
      contact.knownBy.map((person) => person.name),
      isoString(contact.firstContactAt),
      isoString(contact.lastContactAt),
      contact.interactionCount,
      contact.nextStep,
      contact.followUpAt,
      contact.location,
      contact.summary,
      contact.whyInteresting,
      isoString(contact.createdAt),
      isoString(contact.updatedAt),
    ]),
  ]);
}
