/**
 * One change to every contact a filter matches: the stage, the next step,
 * a manual list, or archiving. For a Soko Bot that would otherwise pass
 * thousands of ids; it previews first and changes on confirmation.
 */
import type { Prisma } from "@sokosumi/database";
import { notFound, unprocessableEntity } from "@/helpers/error";
import type { ContactActor } from "@/services/contacts.service";

/** More than this is a mistake or a job for a person: narrow the filter. */
export const MAX_BULK_CONTACTS = 5_000;
/** Ids per statement, well under Postgres's parameter limit. */
const CHUNK = 2_000;

export interface ContactBulkChange {
  stage?: Prisma.ContactUpdateManyMutationInput["stage"];
  nextStep?: string | null;
  followUpAt?: string | null;
  addToListId?: string;
  removeFromListId?: string;
  archived?: boolean;
}

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += CHUNK)
    out.push(items.slice(start, start + CHUNK));
  return out;
}

async function manualList(
  tx: Prisma.TransactionClient,
  actor: ContactActor,
  id: string,
) {
  const list = await tx.contactList.findFirst({
    where: { id, workspaceId: actor.workspaceId },
  });
  if (!list) throw notFound("List not found");
  if (list.smartFilter !== null)
    throw unprocessableEntity(
      "A smart list fills itself from its filter; change the filter instead",
    );
  return list;
}

export interface ContactBulkResult {
  matched: number;
  /** Contacts whose stage, next step, follow-up or archive state changed. */
  fields: number;
  addedToList: number;
  removedFromList: number;
}

const FIELDS = ["stage", "nextStep", "followUpAt", "archivedAt"] as const;

/**
 * Applies `change` to `ids` (contacts of the actor's workspace), and writes
 * each changed contact's history as a single edit would.
 */
export async function bulkUpdateContacts(
  tx: Prisma.TransactionClient,
  actor: ContactActor,
  ids: readonly string[],
  change: ContactBulkChange,
): Promise<ContactBulkResult> {
  if (ids.length > MAX_BULK_CONTACTS)
    throw unprocessableEntity(
      `That is ${ids.length} contacts; narrow it to ${MAX_BULK_CONTACTS} or fewer`,
    );
  const fields: Prisma.ContactUpdateManyMutationInput = {};
  if (change.stage !== undefined) fields.stage = change.stage;
  if (change.nextStep !== undefined) fields.nextStep = change.nextStep;
  if (change.followUpAt !== undefined)
    fields.followUpAt = change.followUpAt
      ? new Date(`${change.followUpAt}T00:00:00Z`)
      : null;
  const addTo = change.addToListId
    ? await manualList(tx, actor, change.addToListId)
    : null;
  const removeFrom = change.removeFromListId
    ? await manualList(tx, actor, change.removeFromListId)
    : null;
  const archiving = change.archived !== undefined;
  if (!addTo && !removeFrom && !archiving && Object.keys(fields).length === 0)
    throw unprocessableEntity("Say what to change");
  const result: ContactBulkResult = {
    matched: ids.length,
    fields: 0,
    addedToList: 0,
    removedFromList: 0,
  };
  for (const chunk of chunks(ids)) {
    const where = {
      id: { in: chunk },
      workspaceId: actor.workspaceId,
      mergedIntoId: null,
    } satisfies Prisma.ContactWhereInput;
    if (Object.keys(fields).length > 0 || archiving) {
      const before = await tx.contact.findMany({
        where,
        select: {
          id: true,
          ...Object.fromEntries(FIELDS.map((f) => [f, true])),
        },
      });
      const activities: Prisma.ContactActivityCreateManyInput[] = [];
      const changed: string[] = [];
      for (const row of before as unknown as Record<string, unknown>[]) {
        const diff: Record<string, { before: unknown; after: unknown }> = {};
        for (const [field, after] of Object.entries(fields)) {
          const was = row[field];
          const same =
            was instanceof Date && after instanceof Date
              ? was.getTime() === after.getTime()
              : was === after;
          if (!same)
            diff[field] = { before: was ?? null, after: after ?? null };
        }
        const wasArchived = row.archivedAt !== null;
        const archiveFlip = archiving && wasArchived !== change.archived;
        if (Object.keys(diff).length === 0 && !archiveFlip) continue;
        changed.push(row.id as string);
        const base = {
          workspaceId: actor.workspaceId,
          contactId: row.id as string,
          userId: actor.userId,
          sokoBotId: actor.sokoBotId,
        };
        if (Object.keys(diff).length > 0)
          activities.push({
            ...base,
            kind: "UPDATED",
            changes: JSON.parse(JSON.stringify(diff)),
          });
        if (archiveFlip)
          activities.push({
            ...base,
            kind: change.archived ? "ARCHIVED" : "UNARCHIVED",
          });
      }
      if (changed.length > 0) {
        await tx.contact.updateMany({
          where: { id: { in: changed } },
          data: {
            ...fields,
            ...(archiving
              ? { archivedAt: change.archived ? new Date() : null }
              : {}),
            version: { increment: 1 },
          },
        });
        await tx.contactActivity.createMany({ data: activities });
      }
      result.fields += changed.length;
    }
    if (addTo) {
      const members = await tx.contact.findMany({
        where,
        select: { id: true },
      });
      result.addedToList += (
        await tx.contactListMember.createMany({
          data: members.map((member) => ({
            listId: addTo.id,
            contactId: member.id,
            addedByUserId: actor.userId,
            addedBySokoBotId: actor.sokoBotId,
          })),
          skipDuplicates: true,
        })
      ).count;
    }
    if (removeFrom)
      result.removedFromList += (
        await tx.contactListMember.deleteMany({
          where: { listId: removeFrom.id, contactId: { in: chunk } },
        })
      ).count;
  }
  return result;
}
