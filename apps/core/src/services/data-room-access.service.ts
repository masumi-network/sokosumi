import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import {
  type DataRoom,
  DataRoomEventKind,
  type DataRoomMember,
  DataRoomStorage,
} from "@sokosumi/database";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import {
  hashSharePassword,
  verifySharePassword,
} from "@/services/drive-share.service";

/** How long an emailed code works. */
export const DATA_ROOM_CODE_MINUTES = 10;
/** Wrong codes before the code stops working; a new one must be asked for. */
const MAX_CODE_ATTEMPTS = 5;
/** A new code is not sent more often than this, so the form cannot spam. */
const CODE_RESEND_MS = 45 * 1000;
/** How long a signed-in browser stays in, unless access ends sooner. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string): string {
  return normalizeEmail(email).split("@").at(-1) ?? "";
}

/** Why a room is shut to everyone at the moment, or null when it is open. */
export function roomClosedReason(
  room: Pick<DataRoom, "storage" | "expiresAt">,
  now = new Date(),
): "closed" | "expired" | null {
  if (room.storage === DataRoomStorage.MOVING_OUT) return "closed";
  if (room.expiresAt && room.expiresAt <= now) return "expired";
  return null;
}

/** True while this person may be in the room. */
export function memberActive(
  member: Pick<DataRoomMember, "revokedAt" | "expiresAt">,
  now = new Date(),
): boolean {
  if (member.revokedAt) return false;
  return !member.expiresAt || member.expiresAt > now;
}

export type CodeRequestOutcome =
  | {
      kind: "sent";
      room: DataRoom;
      member: DataRoomMember;
      code: string;
    }
  /** Not let in, or asked too soon. The answer to the browser is the same. */
  | { kind: "quiet" }
  | { kind: "closed"; reason: "closed" | "expired" }
  | { kind: "missing" };

/**
 * A code for this email, when they may come in: invited and not revoked or
 * expired, or at an allowed domain (then they become a member here). Every
 * other email gets the same quiet answer, so the form cannot tell anyone who
 * is in the room.
 */
export async function requestDataRoomCode(input: {
  token: string;
  email: string;
  now?: Date;
}): Promise<CodeRequestOutcome> {
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.email);
  const room = await prisma.dataRoom.findUnique({
    where: { token: input.token },
  });
  if (!room) return { kind: "missing" };
  const closed = roomClosedReason(room, now);
  if (closed) return { kind: "closed", reason: closed };

  let member = await prisma.dataRoomMember.findUnique({
    where: { roomId_email: { roomId: room.id, email } },
  });
  if (!member && room.allowedDomains.includes(emailDomain(email)))
    member = await prisma.dataRoomMember.create({
      data: { roomId: room.id, email },
    });
  if (!member || !memberActive(member, now)) return { kind: "quiet" };

  const sentAt = member.codeExpiresAt
    ? member.codeExpiresAt.getTime() - DATA_ROOM_CODE_MINUTES * 60 * 1000
    : 0;
  if (now.getTime() - sentAt < CODE_RESEND_MS) return { kind: "quiet" };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  member = await prisma.dataRoomMember.update({
    where: { id: member.id },
    data: {
      codeHash: await hashSharePassword(code),
      codeExpiresAt: new Date(
        now.getTime() + DATA_ROOM_CODE_MINUTES * 60 * 1000,
      ),
      codeAttempts: 0,
    },
  });
  return { kind: "sent", room, member, code };
}

export type CodeVerifyOutcome =
  | {
      kind: "signedIn";
      session: string;
      room: DataRoom;
      member: DataRoomMember;
      firstVisit: boolean;
    }
  | { kind: "wrong" }
  | { kind: "closed"; reason: "closed" | "expired" }
  | { kind: "missing" };

/**
 * Checks a code. Right, it signs this browser in, counts the visit and logs
 * it; wrong, it counts against the code, and enough wrong ones end it.
 */
export async function verifyDataRoomCode(input: {
  token: string;
  email: string;
  code: string;
  now?: Date;
}): Promise<CodeVerifyOutcome> {
  const now = input.now ?? new Date();
  const room = await prisma.dataRoom.findUnique({
    where: { token: input.token },
  });
  if (!room) return { kind: "missing" };
  const closed = roomClosedReason(room, now);
  if (closed) return { kind: "closed", reason: closed };
  const member = await prisma.dataRoomMember.findUnique({
    where: {
      roomId_email: { roomId: room.id, email: normalizeEmail(input.email) },
    },
  });
  if (
    !member ||
    !memberActive(member, now) ||
    !member.codeHash ||
    !member.codeExpiresAt ||
    member.codeExpiresAt <= now ||
    member.codeAttempts >= MAX_CODE_ATTEMPTS
  )
    return { kind: "wrong" };

  if (!(await verifySharePassword(member.codeHash, input.code.trim()))) {
    await prisma.dataRoomMember.update({
      where: { id: member.id },
      data: { codeAttempts: { increment: 1 } },
    });
    return { kind: "wrong" };
  }

  const firstVisit = !member.firstVisitAt;
  const signedIn = await prisma.dataRoomMember.update({
    where: { id: member.id },
    data: {
      codeHash: null,
      codeExpiresAt: null,
      codeAttempts: 0,
      firstVisitAt: member.firstVisitAt ?? now,
      previousVisitAt: member.lastVisitAt,
      lastVisitAt: now,
    },
  });
  await logDataRoomEvent({
    roomId: room.id,
    memberId: member.id,
    kind: DataRoomEventKind.ENTER,
  });
  return {
    kind: "signedIn",
    session: createDataRoomSession(signedIn, now.getTime()),
    room,
    member: signedIn,
    firstVisit,
  };
}

function sessionSignature(payload: string): string {
  return createHmac("sha256", getEnv().BETTER_AUTH_SECRET)
    .update(`data-room-session:${payload}`)
    .digest("base64url");
}

/**
 * Proof that this browser signed in as this member, valid until it expires
 * or the member's session version moves (a revoke, or a new sign-in elsewhere
 * does not end it; a revoke does).
 */
export function createDataRoomSession(
  member: Pick<DataRoomMember, "id" | "sessionVersion">,
  now = Date.now(),
): string {
  const payload = `${member.id}.${member.sessionVersion}.${now + SESSION_TTL_MS}`;
  return `${payload}.${sessionSignature(payload)}`;
}

function readSession(
  session: string | undefined,
  now: number,
): { memberId: string; sessionVersion: number } | null {
  const parts = (session ?? "").split(".");
  if (parts.length !== 4) return null;
  const [memberId, version, expires, signature] = parts as [
    string,
    string,
    string,
    string,
  ];
  const payload = `${memberId}.${version}.${expires}`;
  const wanted = Buffer.from(sessionSignature(payload));
  const given = Buffer.from(signature);
  if (wanted.length !== given.length || !timingSafeEqual(wanted, given))
    return null;
  if (!(Number(expires) > now)) return null;
  const sessionVersion = Number(version);
  if (!Number.isInteger(sessionVersion)) return null;
  return { memberId, sessionVersion };
}

export type DataRoomViewer =
  | { kind: "in"; room: DataRoom; member: DataRoomMember }
  | { kind: "out"; room: DataRoom }
  | { kind: "closed"; room: DataRoom; reason: "closed" | "expired" }
  | { kind: "missing" };

/** Who this browser is in the room, checked fresh on every request. */
export async function resolveDataRoomViewer(input: {
  token: string;
  session: string | undefined;
  now?: Date;
}): Promise<DataRoomViewer> {
  const now = input.now ?? new Date();
  const room = await prisma.dataRoom.findUnique({
    where: { token: input.token },
  });
  if (!room) return { kind: "missing" };
  const closed = roomClosedReason(room, now);
  if (closed) return { kind: "closed", room, reason: closed };
  const proof = readSession(input.session, now.getTime());
  if (!proof) return { kind: "out", room };
  const member = await prisma.dataRoomMember.findUnique({
    where: { id: proof.memberId },
  });
  if (
    !member ||
    member.roomId !== room.id ||
    member.sessionVersion !== proof.sessionVersion ||
    !memberActive(member, now)
  )
    return { kind: "out", room };
  return { kind: "in", room, member };
}

export async function logDataRoomEvent(input: {
  roomId: string;
  memberId: string | null;
  kind: DataRoomEventKind;
  path?: string;
}): Promise<void> {
  await prisma.dataRoomEvent.create({
    data: {
      roomId: input.roomId,
      memberId: input.memberId,
      kind: input.kind,
      path: input.path ?? null,
    },
  });
}

/** True when a member may see a path inside the room (relative to it). */
export function memberSeesPath(
  member: Pick<DataRoomMember, "folderPaths">,
  path: string,
): boolean {
  if (member.folderPaths.length === 0) return true;
  return member.folderPaths.some(
    (folder) => path === folder || path.startsWith(`${folder}/`),
  );
}
