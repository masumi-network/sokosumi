/**
 * A teammate's LinkedIn connections, from the Connections.csv LinkedIn
 * exports (Settings → Data privacy → Get a copy of your data). Each row
 * becomes or updates a contact, keyed by the profile URL, and records that
 * this teammate is connected to them. Imported people are marked enriched
 * and classified, so a few thousand rows start no background model work.
 */

import type { Prisma } from "@sokosumi/database";
import { readCsvRows } from "@sokosumi/utils";
import { unprocessableEntity } from "@/helpers/error";
import { ensureManualContactList } from "@/services/contact-lists.service";
import {
  addContactChannel,
  type ContactActor,
  inContactTransaction,
  normalizeChannels,
  upsertContact,
} from "@/services/contacts.service";

type Tx = Prisma.TransactionClient;

/**
 * The contact this connection already is, when the profile URL is new to the
 * workspace: same name at the same company. The LinkedIn URL is then added
 * to that contact, so the upsert that follows lands on it.
 */
async function attachToNamesake(
  tx: Tx,
  actor: ContactActor,
  connection: LinkedInConnection,
  name: string,
): Promise<void> {
  if (!connection.company) return;
  const [normalized] = normalizeChannels([
    { type: "LINKEDIN", value: connection.url },
  ]);
  if (!normalized) return;
  const owned = await tx.contactChannel.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      type: "LINKEDIN",
      value: normalized.value,
    },
    select: { id: true },
  });
  if (owned) return;
  const namesake = await tx.contact.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      archivedAt: null,
      mergedIntoId: null,
      name: { equals: name, mode: "insensitive" },
      organization: { equals: connection.company, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (!namesake) return;
  await addContactChannel(tx, actor, namesake.id, {
    type: "LINKEDIN",
    value: connection.url,
    source: "IMPORT",
  }).catch(() => undefined);
}

export const LINKEDIN_LIST_NAME = "LinkedIn connections";
/** Rows per transaction: enough to be quick, small enough to keep a lock short. */
const BATCH = 100;
export const MAX_CONNECTIONS = 20_000;

export interface LinkedInConnection {
  firstName: string;
  lastName: string;
  url: string;
  email: string | null;
  company: string | null;
  position: string | null;
  connectedOn: string | null;
}

const HEADERS = {
  firstName: "first name",
  lastName: "last name",
  url: "url",
  email: "email address",
  company: "company",
  position: "position",
  connectedOn: "connected on",
} as const;

/** LinkedIn writes "25 Nov 2026"; kept as an ISO date, or null when unreadable. */
export function parseConnectedOn(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(`${value.trim()} UTC`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * The export's rows. LinkedIn starts the file with a "Notes:" paragraph,
 * so the header is the first row that has the First Name and URL columns.
 */
export function parseLinkedInConnections(csv: string): LinkedInConnection[] {
  const rows = readCsvRows(csv, { maxRows: MAX_CONNECTIONS + 10 });
  const headerIndex = rows.findIndex((row) => {
    const cells = row.map((cell) => cell.trim().toLowerCase());
    return cells.includes(HEADERS.firstName) && cells.includes(HEADERS.url);
  });
  if (headerIndex === -1)
    throw unprocessableEntity(
      "This is not a LinkedIn Connections.csv: no First Name and URL columns",
    );
  const header =
    rows[headerIndex]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const column = (name: string) => header.indexOf(name);
  const index = {
    firstName: column(HEADERS.firstName),
    lastName: column(HEADERS.lastName),
    url: column(HEADERS.url),
    email: column(HEADERS.email),
    company: column(HEADERS.company),
    position: column(HEADERS.position),
    connectedOn: column(HEADERS.connectedOn),
  };
  const cell = (row: string[], at: number) =>
    at >= 0 ? (row[at]?.trim() ?? "") : "";
  return rows.slice(headerIndex + 1).flatMap((row) => {
    const url = cell(row, index.url);
    const firstName = cell(row, index.firstName);
    const lastName = cell(row, index.lastName);
    if (!/^https?:\/\/(www\.)?linkedin\.com\/in\//i.test(url)) return [];
    if (!firstName && !lastName) return [];
    return [
      {
        firstName,
        lastName,
        url,
        email: cell(row, index.email) || null,
        company: cell(row, index.company) || null,
        position: cell(row, index.position) || null,
        connectedOn: parseConnectedOn(cell(row, index.connectedOn) || null),
      },
    ];
  });
}

export interface LinkedInImportResult {
  connections: number;
  created: number;
  updated: number;
  listId: string;
}

/**
 * Imports one teammate's connections. Existing contacts (by LinkedIn URL or
 * email) only gain what they lack; new ones arrive as plain contacts on the
 * "LinkedIn connections" list. Every row records the connection for the
 * importing teammate.
 */
export async function importLinkedInConnections(
  actor: ContactActor,
  connections: LinkedInConnection[],
): Promise<LinkedInImportResult> {
  if (connections.length > MAX_CONNECTIONS)
    throw unprocessableEntity(
      `That is more than ${MAX_CONNECTIONS.toLocaleString("en-US")} connections; split the file`,
    );
  const list = await inContactTransaction((tx) =>
    ensureManualContactList(tx, actor, LINKEDIN_LIST_NAME, "blue"),
  );
  let created = 0;
  let updated = 0;
  for (let start = 0; start < connections.length; start += BATCH) {
    const batch = connections.slice(start, start + BATCH);
    await inContactTransaction(async (tx) => {
      const contactIds: string[] = [];
      for (const connection of batch) {
        const name = `${connection.firstName} ${connection.lastName}`.trim();
        await attachToNamesake(tx, actor, connection, name);
        const result = await upsertContact(
          tx,
          actor,
          {
            name,
            organization: connection.company ?? undefined,
            role: connection.position ?? undefined,
            channels: [
              { type: "LINKEDIN", value: connection.url, source: "IMPORT" },
              ...(connection.email
                ? [
                    {
                      type: "EMAIL" as const,
                      value: connection.email,
                      source: "IMPORT" as const,
                    },
                  ]
                : []),
            ],
            upsert: true,
          },
          { defaultChannelSource: "IMPORT" },
        );
        if (result.created) {
          created += 1;
          await tx.contact.update({
            where: { id: result.contact.id },
            data: { enrichedAt: new Date(), classifiedAt: new Date() },
          });
        } else updated += 1;
        contactIds.push(result.contact.id);
        await tx.contactLinkedInConnection.upsert({
          where: {
            contactId_userId: {
              contactId: result.contact.id,
              userId: actor.userId,
            },
          },
          create: {
            workspaceId: actor.workspaceId,
            contactId: result.contact.id,
            userId: actor.userId,
            connectedOn: connection.connectedOn
              ? new Date(connection.connectedOn)
              : null,
          },
          update: {
            connectedOn: connection.connectedOn
              ? new Date(connection.connectedOn)
              : undefined,
          },
        });
      }
      if (contactIds.length)
        await tx.contactListMember.createMany({
          data: contactIds.map((contactId) => ({
            listId: list.id,
            contactId,
            addedByUserId: actor.userId,
          })),
          skipDuplicates: true,
        });
    });
  }
  return { connections: connections.length, created, updated, listId: list.id };
}
