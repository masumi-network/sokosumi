import { Prisma } from "@sokosumi/database";
import type {
  CONTACT_LIST_COLORS,
  ContactFilter,
  contactListInputSchema,
  contactListMembersSchema,
  contactListUpdateSchema,
} from "@sokosumi/utils";
import type { z } from "zod";
import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import type { contactListSchema } from "@/schemas/contact.schema";
import {
  type ContactActor,
  contactFilterWhere,
  parseSmartFilter,
} from "@/services/contacts.service";

type Tx = Prisma.TransactionClient;
type ContactListDto = z.input<typeof contactListSchema>;
type ContactListRow = Prisma.ContactListGetPayload<object>;
type ListColor = (typeof CONTACT_LIST_COLORS)[number];

/** Members still in the set: not archived and not merged away. */
const LIVE_CONTACT = {
  mergedIntoId: null,
  archivedAt: null,
} satisfies Prisma.ContactWhereInput;

async function listCount(
  actor: ContactActor,
  list: ContactListRow,
  tx: Tx,
): Promise<number> {
  const smart = parseSmartFilter(list.smartFilter);
  return tx.contact.count({
    where: {
      workspaceId: actor.workspaceId,
      ...LIVE_CONTACT,
      AND: smart
        ? contactFilterWhere(actor, smart)
        : [{ listMemberships: { some: { listId: list.id } } }],
    },
  });
}

async function toListDto(
  actor: ContactActor,
  list: ContactListRow,
  tx: Tx = prisma,
): Promise<ContactListDto> {
  const smartFilter = parseSmartFilter(list.smartFilter);
  return {
    id: list.id,
    name: list.name,
    color: list.color as ListColor,
    description: list.description,
    kind: smartFilter ? "smart" : "manual",
    smartFilter,
    count: await listCount(actor, list, tx),
    createdByUserId: list.createdByUserId,
    createdBySokoBotId: list.createdBySokoBotId,
    createdAutomatically: list.createdAutomatically,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
  };
}

/** Lists in name order, each with its live count. */
export async function listContactLists(
  actor: ContactActor,
): Promise<ContactListDto[]> {
  const lists = await prisma.contactList.findMany({
    where: { workspaceId: actor.workspaceId },
    orderBy: [{ nameKey: "asc" }, { id: "asc" }],
  });
  return Promise.all(lists.map((list) => toListDto(actor, list)));
}

async function requireList(tx: Tx, actor: ContactActor, id: string) {
  const list = await tx.contactList.findFirst({
    where: { id, workspaceId: actor.workspaceId },
  });
  if (!list) throw notFound("List not found");
  return list;
}

export function contactListNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** A smart filter may name manual lists of this workspace, not smart ones. */
async function checkSmartFilter(
  tx: Tx,
  actor: ContactActor,
  filter: ContactFilter | null | undefined,
) {
  if (!filter?.listIds) return;
  const manual = await tx.contactList.count({
    where: {
      id: { in: filter.listIds },
      workspaceId: actor.workspaceId,
      smartFilter: { equals: Prisma.DbNull },
    },
  });
  if (manual !== new Set(filter.listIds).size)
    throw unprocessableEntity(
      "A smart list can only refer to manual lists in this workspace",
    );
}

function nameTaken(error: unknown): never {
  if (isPrismaUniqueViolation(error))
    throw conflict("A list with this name already exists");
  throw error;
}

export async function createContactList(
  tx: Tx,
  actor: ContactActor,
  input: z.infer<typeof contactListInputSchema>,
  options: { automatic?: boolean } = {},
): Promise<ContactListDto> {
  await checkSmartFilter(tx, actor, input.smartFilter);
  const existing = await tx.contactList.findUnique({
    where: {
      workspaceId_nameKey: {
        workspaceId: actor.workspaceId,
        nameKey: contactListNameKey(input.name),
      },
    },
  });
  if (existing) throw conflict("A list with this name already exists");
  const list = await tx.contactList
    .create({
      data: {
        workspaceId: actor.workspaceId,
        name: input.name,
        nameKey: contactListNameKey(input.name),
        color: input.color,
        description: input.description ?? null,
        smartFilter: input.smartFilter ?? Prisma.DbNull,
        createdByUserId: actor.userId,
        createdBySokoBotId: actor.sokoBotId,
        createdAutomatically: options.automatic ?? false,
      },
    })
    .catch(nameTaken);
  return toListDto(actor, list, tx);
}

export async function updateContactList(
  tx: Tx,
  actor: ContactActor,
  id: string,
  input: z.infer<typeof contactListUpdateSchema>,
): Promise<ContactListDto> {
  const list = await requireList(tx, actor, id);
  await checkSmartFilter(tx, actor, input.smartFilter);
  if (input.smartFilter?.listIds?.includes(id))
    throw unprocessableEntity("A smart list cannot refer to itself");
  if (input.name && contactListNameKey(input.name) !== list.nameKey) {
    const clash = await tx.contactList.findUnique({
      where: {
        workspaceId_nameKey: {
          workspaceId: actor.workspaceId,
          nameKey: contactListNameKey(input.name),
        },
      },
    });
    if (clash) throw conflict("A list with this name already exists");
  }
  const turnsSmart =
    input.smartFilter !== undefined && input.smartFilter !== null;
  if (turnsSmart && !list.smartFilter)
    await tx.contactListMember.deleteMany({ where: { listId: id } });
  const updated = await tx.contactList
    .update({
      where: { id },
      data: {
        ...(input.name
          ? { name: input.name, nameKey: contactListNameKey(input.name) }
          : {}),
        ...(input.color ? { color: input.color } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.smartFilter !== undefined
          ? { smartFilter: input.smartFilter ?? Prisma.DbNull }
          : {}),
      },
    })
    .catch(nameTaken);
  return toListDto(actor, updated, tx);
}

export async function deleteContactList(
  tx: Tx,
  actor: ContactActor,
  id: string,
): Promise<void> {
  await requireList(tx, actor, id);
  const referencing = await tx.contactList.findMany({
    where: {
      workspaceId: actor.workspaceId,
      smartFilter: { path: ["listIds"], array_contains: [id] },
    },
    select: { name: true },
  });
  if (referencing.length)
    throw conflict(
      `Smart lists use this list: ${referencing.map((list) => list.name).join(", ")}`,
    );
  await tx.contactList.delete({ where: { id } });
}

/**
 * Adds and removes members of a manual list; smart lists fill themselves.
 * `automatic` marks the additions as the background classifier's, so people
 * can see them and undo them.
 */
export async function updateContactListMembers(
  tx: Tx,
  actor: ContactActor,
  id: string,
  input: z.infer<typeof contactListMembersSchema>,
  options: { automatic?: boolean } = {},
): Promise<ContactListDto> {
  const list = await requireList(tx, actor, id);
  if (list.smartFilter)
    throw unprocessableEntity(
      "A smart list updates itself; change its filter instead",
    );
  const add = [...new Set(input.add)];
  if (add.length) {
    const found = await tx.contact.count({
      where: {
        id: { in: add },
        workspaceId: actor.workspaceId,
        mergedIntoId: null,
      },
    });
    if (found !== add.length) throw notFound("Contact not found");
    await tx.contactListMember.createMany({
      data: add.map((contactId) => ({
        listId: id,
        contactId,
        addedByUserId: actor.userId,
        addedBySokoBotId: actor.sokoBotId,
        addedAutomatically: options.automatic ?? false,
      })),
      skipDuplicates: true,
    });
  }
  if (input.remove.length)
    await tx.contactListMember.deleteMany({
      where: { listId: id, contactId: { in: input.remove } },
    });
  await tx.contactList.update({
    where: { id },
    data: { updatedAt: new Date() },
  });
  return toListDto(actor, list, tx);
}

/** The manual list of this name, created when missing; for imports. */
export async function ensureManualContactList(
  tx: Tx,
  actor: ContactActor,
  name: string,
  color: ListColor,
): Promise<{ id: string; created: boolean }> {
  const nameKey = contactListNameKey(name);
  const existing = await tx.contactList.findUnique({
    where: { workspaceId_nameKey: { workspaceId: actor.workspaceId, nameKey } },
    select: { id: true, smartFilter: true },
  });
  if (existing) {
    if (existing.smartFilter)
      throw unprocessableEntity(`"${name}" is a smart list`);
    return { id: existing.id, created: false };
  }
  const list = await tx.contactList.create({
    data: {
      workspaceId: actor.workspaceId,
      name: name.trim(),
      nameKey,
      color,
      createdByUserId: actor.userId,
      createdBySokoBotId: actor.sokoBotId,
    },
    select: { id: true },
  });
  return { id: list.id, created: true };
}
