import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({
  getEnv: () => ({ BETTER_AUTH_SECRET: "test-secret" }),
}));
const db = vi.hoisted(() => ({
  dataRoom: { findUnique: vi.fn() },
  dataRoomMember: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  dataRoomEvent: { create: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));

import {
  createDataRoomSession,
  memberSeesPath,
  requestDataRoomCode,
  resolveDataRoomViewer,
  verifyDataRoomCode,
} from "./data-room-access.service";
import { hashSharePassword } from "./drive-share.service";

const NOW = new Date("2026-11-09T12:00:00.000Z");
const room = {
  id: "room-1",
  token: "tok",
  storage: "PRIVATE",
  expiresAt: null,
  allowedDomains: ["fund.com"],
};
const member = {
  id: "m-1",
  roomId: "room-1",
  email: "anna@fund.com",
  name: "Anna",
  revokedAt: null,
  expiresAt: null,
  folderPaths: [],
  codeHash: null,
  codeExpiresAt: null,
  codeAttempts: 0,
  sessionVersion: 0,
  firstVisitAt: null,
  lastVisitAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.dataRoom.findUnique.mockResolvedValue(room);
  db.dataRoomMember.update.mockImplementation(async ({ data }) => ({
    ...member,
    ...data,
  }));
});

describe("requestDataRoomCode", () => {
  it("sends a six-digit code to someone let in", async () => {
    db.dataRoomMember.findUnique.mockResolvedValue(member);
    const outcome = await requestDataRoomCode({
      token: "tok",
      email: " Anna@Fund.com ",
      now: NOW,
    });
    expect(outcome.kind).toBe("sent");
    if (outcome.kind !== "sent") return;
    expect(outcome.code).toMatch(/^\d{6}$/);
    expect(db.dataRoomMember.findUnique).toHaveBeenCalledWith({
      where: { roomId_email: { roomId: "room-1", email: "anna@fund.com" } },
    });
  });

  it("answers quietly for someone not let in, so nobody learns who is", async () => {
    db.dataRoomMember.findUnique.mockResolvedValue(null);
    await expect(
      requestDataRoomCode({ token: "tok", email: "eve@other.com", now: NOW }),
    ).resolves.toEqual({ kind: "quiet" });
    expect(db.dataRoomMember.create).not.toHaveBeenCalled();
  });

  it("lets in someone at an allowed domain on their first code", async () => {
    db.dataRoomMember.findUnique.mockResolvedValue(null);
    db.dataRoomMember.create.mockResolvedValue({
      ...member,
      email: "ben@fund.com",
    });
    const outcome = await requestDataRoomCode({
      token: "tok",
      email: "ben@fund.com",
      now: NOW,
    });
    expect(outcome.kind).toBe("sent");
    expect(db.dataRoomMember.create).toHaveBeenCalledWith({
      data: { roomId: "room-1", email: "ben@fund.com" },
    });
  });

  it("sends nothing to someone removed, or whose access ended", async () => {
    db.dataRoomMember.findUnique.mockResolvedValue({
      ...member,
      revokedAt: NOW,
    });
    await expect(
      requestDataRoomCode({ token: "tok", email: member.email, now: NOW }),
    ).resolves.toEqual({ kind: "quiet" });
    db.dataRoomMember.findUnique.mockResolvedValue({
      ...member,
      expiresAt: new Date(NOW.getTime() - 1),
    });
    await expect(
      requestDataRoomCode({ token: "tok", email: member.email, now: NOW }),
    ).resolves.toEqual({ kind: "quiet" });
  });

  it("does not send a second code within the minute", async () => {
    db.dataRoomMember.findUnique.mockResolvedValue({
      ...member,
      codeExpiresAt: new Date(NOW.getTime() + 9.8 * 60 * 1000),
    });
    await expect(
      requestDataRoomCode({ token: "tok", email: member.email, now: NOW }),
    ).resolves.toEqual({ kind: "quiet" });
  });

  it("says a room is closed rather than sending a code", async () => {
    db.dataRoom.findUnique.mockResolvedValue({
      ...room,
      expiresAt: new Date(NOW.getTime() - 1),
    });
    await expect(
      requestDataRoomCode({ token: "tok", email: member.email, now: NOW }),
    ).resolves.toEqual({ kind: "closed", reason: "expired" });
  });
});

describe("verifyDataRoomCode", () => {
  async function withCode(code: string, extra: object = {}) {
    db.dataRoomMember.findUnique.mockResolvedValue({
      ...member,
      codeHash: await hashSharePassword(code),
      codeExpiresAt: new Date(NOW.getTime() + 5 * 60 * 1000),
      ...extra,
    });
  }

  it("signs in with the right code, counts the first visit and logs it", async () => {
    await withCode("123456");
    const outcome = await verifyDataRoomCode({
      token: "tok",
      email: member.email,
      code: "123456",
      now: NOW,
    });
    expect(outcome).toMatchObject({ kind: "signedIn", firstVisit: true });
    expect(db.dataRoomMember.update).toHaveBeenCalledWith({
      where: { id: "m-1" },
      data: expect.objectContaining({
        codeHash: null,
        firstVisitAt: NOW,
        lastVisitAt: NOW,
      }),
    });
    expect(db.dataRoomEvent.create).toHaveBeenCalledWith({
      data: { roomId: "room-1", memberId: "m-1", kind: "ENTER", path: null },
    });
  });

  it("counts a wrong code and signs nobody in", async () => {
    await withCode("123456");
    await expect(
      verifyDataRoomCode({
        token: "tok",
        email: member.email,
        code: "654321",
        now: NOW,
      }),
    ).resolves.toEqual({ kind: "wrong" });
    expect(db.dataRoomMember.update).toHaveBeenCalledWith({
      where: { id: "m-1" },
      data: { codeAttempts: { increment: 1 } },
    });
  });

  it("refuses even the right code after five wrong ones", async () => {
    await withCode("123456", { codeAttempts: 5 });
    await expect(
      verifyDataRoomCode({
        token: "tok",
        email: member.email,
        code: "123456",
        now: NOW,
      }),
    ).resolves.toEqual({ kind: "wrong" });
  });
});

describe("resolveDataRoomViewer", () => {
  it("lets a signed-in browser in", async () => {
    db.dataRoomMember.findUnique.mockResolvedValue(member);
    const session = createDataRoomSession(member, NOW.getTime());
    await expect(
      resolveDataRoomViewer({ token: "tok", session, now: NOW }),
    ).resolves.toMatchObject({ kind: "in", member: { id: "m-1" } });
  });

  it("ends a session the moment the person is removed", async () => {
    const session = createDataRoomSession(member, NOW.getTime());
    db.dataRoomMember.findUnique.mockResolvedValue({
      ...member,
      revokedAt: NOW,
      sessionVersion: 1,
    });
    await expect(
      resolveDataRoomViewer({ token: "tok", session, now: NOW }),
    ).resolves.toMatchObject({ kind: "out" });
  });

  it("never takes a forged or expired session", async () => {
    db.dataRoomMember.findUnique.mockResolvedValue(member);
    const session = createDataRoomSession(member, NOW.getTime());
    const forged = `${session.split(".").slice(0, 3).join(".")}.AAAA`;
    await expect(
      resolveDataRoomViewer({ token: "tok", session: forged, now: NOW }),
    ).resolves.toMatchObject({ kind: "out" });
    await expect(
      resolveDataRoomViewer({
        token: "tok",
        session,
        now: new Date(NOW.getTime() + 13 * 60 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ kind: "out" });
  });

  it("never lets a session from one room into another", async () => {
    db.dataRoomMember.findUnique.mockResolvedValue({
      ...member,
      roomId: "room-2",
    });
    const session = createDataRoomSession(member, NOW.getTime());
    await expect(
      resolveDataRoomViewer({ token: "tok", session, now: NOW }),
    ).resolves.toMatchObject({ kind: "out" });
  });
});

describe("memberSeesPath", () => {
  it("shows everything when no folders are set, and only those folders otherwise", () => {
    expect(memberSeesPath({ folderPaths: [] }, "Legal/nda.pdf")).toBe(true);
    const legalOnly = { folderPaths: ["Legal"] };
    expect(memberSeesPath(legalOnly, "Legal/nda.pdf")).toBe(true);
    expect(memberSeesPath(legalOnly, "Legal Team/notes.pdf")).toBe(false);
    expect(memberSeesPath(legalOnly, "Finance/model.xlsx")).toBe(false);
  });
});
