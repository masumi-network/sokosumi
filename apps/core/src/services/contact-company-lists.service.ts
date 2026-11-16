import type { Prisma } from "@sokosumi/database";
import type {
  CONTACT_LIST_COLORS,
  companyListInputSchema,
  companyListMembersSchema,
  companyListUpdateSchema,
} from "@sokosumi/utils";
import type { z } from "zod";
import { conflict, notFound } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import type { contactCompanyListSchema } from "@/schemas/contact.schema";
import { contactListNameKey } from "@/services/contact-lists.service";
import type { ContactActor } from "@/services/contacts.service";

type Tx = Prisma.TransactionClient;
export type CompanyListDto = z.input<typeof contactCompanyListSchema>;
type CompanyListRow = Prisma.ContactCompanyListGetPayload<object>;
type ListColor = (typeof CONTACT_LIST_COLORS)[number];

/** Companies someone still works at, as the Companies table shows them. */
const ACTIVE_COMPANY = {
  company: { inactiveSince: null },
} satisfies Prisma.ContactCompanyListMemberWhereInput;

async function toDto(
  list: CompanyListRow,
  tx: Tx = prisma,
): Promise<CompanyListDto> {
  return {
    id: list.id,
    name: list.name,
    color: list.color as ListColor,
    description: list.description,
    count: await tx.contactCompanyListMember.count({
      where: { listId: list.id, ...ACTIVE_COMPANY },
    }),
    createdByUserId: list.createdByUserId,
    createdBySokoBotId: list.createdBySokoBotId,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
  };
}

/** Company lists in name order, each with its count. */
export async function listCompanyLists(
  actor: ContactActor,
): Promise<CompanyListDto[]> {
  const lists = await prisma.contactCompanyList.findMany({
    where: { workspaceId: actor.workspaceId },
    orderBy: [{ nameKey: "asc" }, { id: "asc" }],
  });
  return Promise.all(lists.map((list) => toDto(list)));
}

async function requireList(tx: Tx, actor: ContactActor, id: string) {
  const list = await tx.contactCompanyList.findFirst({
    where: { id, workspaceId: actor.workspaceId },
  });
  if (!list) throw notFound("List not found");
  return list;
}

function nameTaken(error: unknown): never {
  if (isPrismaUniqueViolation(error))
    throw conflict("A company list with this name already exists");
  throw error;
}

export async function createCompanyList(
  tx: Tx,
  actor: ContactActor,
  input: z.infer<typeof companyListInputSchema>,
): Promise<CompanyListDto> {
  const list = await tx.contactCompanyList
    .create({
      data: {
        workspaceId: actor.workspaceId,
        name: input.name,
        nameKey: contactListNameKey(input.name),
        color: input.color,
        description: input.description ?? null,
        createdByUserId: actor.userId,
        createdBySokoBotId: actor.sokoBotId,
      },
    })
    .catch(nameTaken);
  return toDto(list, tx);
}

export async function updateCompanyList(
  tx: Tx,
  actor: ContactActor,
  id: string,
  input: z.infer<typeof companyListUpdateSchema>,
): Promise<CompanyListDto> {
  await requireList(tx, actor, id);
  const updated = await tx.contactCompanyList
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
      },
    })
    .catch(nameTaken);
  return toDto(updated, tx);
}

export async function deleteCompanyList(
  tx: Tx,
  actor: ContactActor,
  id: string,
): Promise<void> {
  await requireList(tx, actor, id);
  await tx.contactCompanyList.delete({ where: { id } });
}

/** Adds and removes companies on a company list; adding one twice is a no-op. */
export async function updateCompanyListMembers(
  tx: Tx,
  actor: ContactActor,
  id: string,
  input: z.infer<typeof companyListMembersSchema>,
): Promise<CompanyListDto> {
  const list = await requireList(tx, actor, id);
  const add = [...new Set(input.add)];
  if (add.length) {
    const found = await tx.contactCompany.count({
      where: { id: { in: add }, workspaceId: actor.workspaceId },
    });
    if (found !== add.length) throw notFound("Company not found");
    await tx.contactCompanyListMember.createMany({
      data: add.map((companyId) => ({
        listId: id,
        companyId,
        addedByUserId: actor.userId,
        addedBySokoBotId: actor.sokoBotId,
      })),
      skipDuplicates: true,
    });
  }
  if (input.remove.length)
    await tx.contactCompanyListMember.deleteMany({
      where: { listId: id, companyId: { in: input.remove } },
    });
  const touched = await tx.contactCompanyList.update({
    where: { id },
    data: { updatedAt: new Date() },
  });
  return toDto({ ...list, updatedAt: touched.updatedAt }, tx);
}
