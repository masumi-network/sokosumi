/**
 * A workspace's raise: the contacts on its "Investors" list, each with where
 * they stand (stage, owner, cheque, thesis, notes) and what they did in the
 * workspace's data rooms. Next step, follow-up date and last touch are the
 * contact's own fields, so the Contacts tab and the pipeline never disagree.
 */
import { DataRoomEventKind, Prisma } from "@sokosumi/database";
import { getEnv } from "@/config/env";
import { notFound, unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type {
  FundraisingDataRoomVisitDto,
  FundraisingPipelineDto,
  FundraisingProspectDto,
  FundraisingProspectUpdate,
} from "@/schemas/fundraising.schema";
import {
  CONTACT_INCLUDE,
  type ContactActor,
  contactDtos,
} from "@/services/contacts.service";
import { researchStatus } from "@/services/fundraising-research.service";

/** `nameKey` of the list the pipeline runs over. */
export const INVESTORS_LIST_NAME_KEY = "investors";
const PIPELINE_LIMIT = 500;

export interface FundraisingActor extends ContactActor {
  organizationId: string;
}

type ContactDto = Awaited<ReturnType<typeof contactDtos>>[number];
type ProspectRow = Prisma.FundraisingProspectGetPayload<object>;
type RoomRow = Prisma.DataRoomGetPayload<{
  select: { id: true; title: true; folderPath: true; token: true };
}>;
type MemberRow = Prisma.DataRoomMemberGetPayload<object>;

export function fundraisingEnabled(organizationId: string | null): boolean {
  return (
    organizationId !== null &&
    getEnv().FUNDRAISING_ORGANIZATION_IDS.includes(organizationId)
  );
}

/** The organization id when it has Fundraising; 404 otherwise, so the pages do not exist for anyone else. */
export function requireFundraising(organizationId: string | null): string {
  if (organizationId === null || !fundraisingEnabled(organizationId))
    throw notFound("Fundraising is not on for this workspace");
  return organizationId;
}

export function roomTitle(room: Pick<RoomRow, "title" | "folderPath">): string {
  return room.title ?? room.folderPath.split("/").at(-1) ?? room.folderPath;
}

function contactEmails(contact: ContactDto): string[] {
  return contact.channels
    .filter((channel) => channel.type === "EMAIL")
    .map((channel) => channel.value.toLowerCase());
}

/**
 * Each contact's data room record, by the emails it can be reached at. A
 * person invited to several rooms shows the one they visited last.
 */
export async function dataRoomVisits(
  rooms: RoomRow[],
  contacts: ContactDto[],
): Promise<Map<string, FundraisingDataRoomVisitDto>> {
  const emails = [...new Set(contacts.flatMap(contactEmails))];
  if (rooms.length === 0 || emails.length === 0) return new Map();
  const members = await prisma.dataRoomMember.findMany({
    where: {
      roomId: { in: rooms.map((room) => room.id) },
      email: { in: emails },
    },
  });
  if (members.length === 0) return new Map();
  const memberIds = members.map((member) => member.id);
  const [counts, lastViews] = await Promise.all([
    prisma.dataRoomEvent.groupBy({
      by: ["memberId", "kind"],
      where: { memberId: { in: memberIds } },
      _count: { _all: true },
    }),
    prisma.dataRoomEvent.findMany({
      where: { memberId: { in: memberIds }, kind: DataRoomEventKind.VIEW },
      orderBy: [{ memberId: "asc" }, { createdAt: "desc" }],
      distinct: ["memberId"],
      select: { memberId: true, path: true },
    }),
  ]);
  const count = (memberId: string, kinds: DataRoomEventKind[]) =>
    counts
      .filter((row) => row.memberId === memberId && kinds.includes(row.kind))
      .reduce((sum, row) => sum + row._count._all, 0);
  const visitOf = (member: MemberRow): FundraisingDataRoomVisitDto => {
    const room = rooms.find((candidate) => candidate.id === member.roomId);
    return {
      roomId: member.roomId,
      roomTitle: room ? roomTitle(room) : "",
      memberId: member.id,
      email: member.email,
      invitedAt: member.createdAt,
      firstVisitAt: member.firstVisitAt,
      lastVisitAt: member.lastVisitAt,
      views: count(member.id, [DataRoomEventKind.VIEW]),
      downloads: count(member.id, [
        DataRoomEventKind.DOWNLOAD,
        DataRoomEventKind.DOWNLOAD_ALL,
      ]),
      lastOpened:
        lastViews.find((view) => view.memberId === member.id)?.path ?? null,
      revoked: member.revokedAt !== null,
    };
  };
  const later = (a: MemberRow, b: MemberRow) =>
    (a.lastVisitAt?.getTime() ?? 0) - (b.lastVisitAt?.getTime() ?? 0) ||
    a.createdAt.getTime() - b.createdAt.getTime();
  const visits = new Map<string, FundraisingDataRoomVisitDto>();
  for (const contact of contacts) {
    const mine = members
      .filter((member) => contactEmails(contact).includes(member.email))
      .sort(later);
    const best = mine.at(-1);
    if (best) visits.set(contact.id, visitOf(best));
  }
  return visits;
}

async function owners(
  prospects: ProspectRow[],
): Promise<Map<string, FundraisingProspectDto["owner"]>> {
  const ids = [
    ...new Set(
      prospects.flatMap((row) => (row.ownerUserId ? [row.ownerUserId] : [])),
    ),
  ];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, image: true },
  });
  return new Map(users.map((user) => [user.id, user]));
}

function toProspectDto(
  contact: ContactDto,
  row: ProspectRow | undefined,
  owner: FundraisingProspectDto["owner"],
  dataRoom: FundraisingDataRoomVisitDto | undefined,
): FundraisingProspectDto {
  return {
    contact,
    stage: row?.stage ?? "TO_RESEARCH",
    stageChangedAt:
      row && row.stage !== "TO_RESEARCH" ? row.stageChangedAt : null,
    owner: owner ?? null,
    ticketSize: row?.ticketSize ?? null,
    thesis: row?.thesis ?? null,
    committedUsd: row?.committedUsd ?? null,
    notes: row?.notes ?? null,
    source: row?.source ?? null,
    dataRoom: dataRoom ?? null,
  };
}

async function prospectDtos(
  actor: FundraisingActor,
  contacts: ContactDto[],
): Promise<{ prospects: FundraisingProspectDto[]; rooms: RoomRow[] }> {
  const ids = contacts.map((contact) => contact.id);
  const [rows, rooms] = await Promise.all([
    prisma.fundraisingProspect.findMany({
      where: { workspaceId: actor.workspaceId, contactId: { in: ids } },
    }),
    prisma.dataRoom.findMany({
      where: { workspaceId: actor.workspaceId },
      select: { id: true, title: true, folderPath: true, token: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const [people, visits] = await Promise.all([
    owners(rows),
    dataRoomVisits(rooms, contacts),
  ]);
  const byContact = new Map(rows.map((row) => [row.contactId, row]));
  return {
    rooms,
    prospects: contacts.map((contact) => {
      const row = byContact.get(contact.id);
      return toProspectDto(
        contact,
        row,
        (row?.ownerUserId ? people.get(row.ownerUserId) : null) ?? null,
        visits.get(contact.id),
      );
    }),
  };
}

/** The live contacts on the Investors list, each with its raise record. */
export async function listFundraisingPipeline(
  actor: FundraisingActor,
): Promise<FundraisingPipelineDto> {
  const list = await prisma.contactList.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      nameKey: INVESTORS_LIST_NAME_KEY,
      smartFilter: { equals: Prisma.DbNull },
    },
    select: { id: true, name: true },
  });
  const research = await researchStatus(actor);
  if (!list) return { list: null, rooms: [], prospects: [], research };
  const rows = await prisma.contact.findMany({
    where: {
      workspaceId: actor.workspaceId,
      archivedAt: null,
      mergedIntoId: null,
      listMemberships: { some: { listId: list.id } },
    },
    include: CONTACT_INCLUDE,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: PIPELINE_LIMIT,
  });
  const contacts = await contactDtos(rows, prisma, actor.userId);
  const { prospects, rooms } = await prospectDtos(actor, contacts);
  return {
    list,
    rooms: rooms.map((room) => ({
      id: room.id,
      title: roomTitle(room),
      token: room.token,
    })),
    prospects,
    research,
  };
}

/** Writes the raise fields of one investor; the row is made on first write. */
export async function updateFundraisingProspect(
  actor: FundraisingActor,
  contactId: string,
  patch: FundraisingProspectUpdate,
): Promise<FundraisingProspectDto> {
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      workspaceId: actor.workspaceId,
      archivedAt: null,
      mergedIntoId: null,
    },
    include: CONTACT_INCLUDE,
  });
  if (!contact) throw notFound("Contact not found");
  if (patch.ownerUserId) {
    const member = await prisma.member.findFirst({
      where: {
        userId: patch.ownerUserId,
        organizationId: actor.organizationId,
      },
      select: { id: true },
    });
    if (!member)
      throw unprocessableEntity(
        "The owner must be a member of the organization",
      );
  }
  const existing = await prisma.fundraisingProspect.findUnique({
    where: { contactId },
  });
  const stageChanged =
    patch.stage !== undefined &&
    patch.stage !== (existing?.stage ?? "TO_RESEARCH");
  const fields = {
    ...patch,
    ...(stageChanged ? { stageChangedAt: new Date() } : {}),
  };
  await prisma.fundraisingProspect.upsert({
    where: { contactId },
    create: { workspaceId: actor.workspaceId, contactId, ...fields },
    update: fields,
  });
  const [dto] = await contactDtos([contact], prisma, actor.userId);
  if (!dto) throw notFound("Contact not found");
  const { prospects } = await prospectDtos(actor, [dto]);
  const prospect = prospects[0];
  if (!prospect) throw notFound("Contact not found");
  return prospect;
}
