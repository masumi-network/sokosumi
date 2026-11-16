import type { DataRoom, DataRoomMember } from "@sokosumi/database";

import { getWebAppBaseUrl } from "@/config/env";
import { sendEmailInBackground } from "@/helpers/background-email";
import prisma from "@/lib/db/prisma";
import { DATA_ROOM_CODE_MINUTES } from "@/services/data-room-access.service";

/** What a room is called to its viewers: its title, or its folder's name. */
export function dataRoomName(
  room: Pick<DataRoom, "title" | "folderPath">,
): string {
  return room.title ?? room.folderPath.split("/").at(-1) ?? room.folderPath;
}

export function dataRoomLink(room: Pick<DataRoom, "token">): string {
  return `${getWebAppBaseUrl()}/share/rooms/${encodeURIComponent(room.token)}`;
}

export async function sendDataRoomInvitations(input: {
  room: DataRoom;
  members: DataRoomMember[];
  inviterName: string;
  locale?: string;
}): Promise<void> {
  const { renderDataRoomInvitationEmail } = await import("@sokosumi/email");
  const rendered = await renderDataRoomInvitationEmail({
    invitationLink: dataRoomLink(input.room),
    invitorUsername: input.inviterName,
    locale: input.locale,
    roomName: dataRoomName(input.room),
  });
  for (const member of input.members) {
    sendEmailInBackground(
      {
        to: member.email,
        tag: "data-room-invitation-email",
        subject: rendered.subject,
        html: rendered.html,
      },
      {
        label: "data_room_invitation_email",
        extra: { roomId: input.room.id, memberId: member.id },
      },
    );
  }
}

export async function sendDataRoomCode(input: {
  room: DataRoom;
  member: DataRoomMember;
  code: string;
  locale?: string;
}): Promise<void> {
  const { renderDataRoomCodeEmail } = await import("@sokosumi/email");
  const rendered = await renderDataRoomCodeEmail({
    code: input.code,
    expiresInMinutes: DATA_ROOM_CODE_MINUTES,
    locale: input.locale,
    roomName: dataRoomName(input.room),
  });
  sendEmailInBackground(
    {
      to: input.member.email,
      tag: "data-room-code-email",
      subject: rendered.subject,
      html: rendered.html,
    },
    {
      label: "data_room_code_email",
      extra: { roomId: input.room.id, memberId: input.member.id },
    },
  );
}

/** Tells the room's creator someone came in for the first time. */
export async function notifyDataRoomFirstVisit(input: {
  room: DataRoom;
  member: DataRoomMember;
  locale?: string;
}): Promise<void> {
  if (!input.room.notifyOnFirstVisit) return;
  const owner = await prisma.user.findUnique({
    where: { id: input.room.createdByUserId },
    select: { email: true },
  });
  if (!owner?.email) return;
  const { renderDataRoomFirstVisitEmail } = await import("@sokosumi/email");
  const visitor = input.member.name
    ? `${input.member.name} (${input.member.email})`
    : input.member.email;
  const rendered = await renderDataRoomFirstVisitEmail({
    activityLink: `${getWebAppBaseUrl()}/drive/data-rooms/${input.room.id}`,
    locale: input.locale,
    roomName: dataRoomName(input.room),
    visitor,
  });
  sendEmailInBackground(
    {
      to: owner.email,
      tag: "data-room-first-visit-email",
      subject: rendered.subject,
      html: rendered.html,
    },
    {
      label: "data_room_first_visit_email",
      extra: { roomId: input.room.id, memberId: input.member.id },
    },
  );
}
