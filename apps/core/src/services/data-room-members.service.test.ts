import { DataRoomStorage } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  dataRoom: { findMany: vi.fn() },
  dataRoomQuestion: { count: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));
const visibility = vi.hoisted(() => ({
  canSeeDataRoom: vi.fn(),
  hiddenDataRoomFolders: vi.fn(),
}));
vi.mock("@/lib/data-room-visibility", () => visibility);
// Only the room list is under test; the stores and files behind it are not.
vi.mock("@/lib/drive-blob", () => ({}));
vi.mock("@vercel/blob", () => ({}));
vi.mock("@/services/data-room-access.service", () => ({}));
vi.mock("@/services/data-room-files.service", () => ({}));
vi.mock("@/services/cmo-brand-media.service", () => ({
  CMO_BRAND_MEDIA_FOLDER: "Brand research",
}));
vi.mock("@/services/image-studio-drive.service", () => ({
  IMAGE_STUDIO_DRIVE_FOLDER: "Content Studio",
}));
vi.mock("@/services/marketing-strategy-files.service", () => ({
  MARKETING_FILES_FOLDER: "Marketing",
}));

import { listWaitingDataRoomQuestions } from "./data-room-members.service";

const store = {
  workspaceId: "ws_1",
  scope: "organization" as const,
  ownerId: "org_1",
  actor: { userId: "u_member", kind: "interactive" as const },
} as Parameters<typeof listWaitingDataRoomQuestions>[0];

function room(
  id: string,
  folderPath: string,
  storage: DataRoomStorage = DataRoomStorage.PRIVATE,
) {
  return { id, folderPath, title: null, storage };
}

beforeEach(() => {
  vi.clearAllMocks();
  visibility.hiddenDataRoomFolders.mockResolvedValue([]);
  db.dataRoomQuestion.count.mockResolvedValue(0);
  db.dataRoomQuestion.findMany.mockResolvedValue([]);
});

describe("listWaitingDataRoomQuestions", () => {
  it("reads only unanswered questions in rooms the caller may run", async () => {
    db.dataRoom.findMany.mockResolvedValue([
      room("r_open", "Series A"),
      room("r_hidden", "Board"),
      room("r_closing", "Old deal", DataRoomStorage.MOVING_OUT),
    ]);
    visibility.hiddenDataRoomFolders.mockResolvedValue(["Board"]);
    db.dataRoomQuestion.count.mockResolvedValue(3);
    db.dataRoomQuestion.findMany.mockResolvedValue([
      {
        id: "q1",
        roomId: "r_open",
        member: { email: "ada@example.com", name: null },
      },
    ]);

    const result = await listWaitingDataRoomQuestions(store, { take: 50 });

    const where = { roomId: { in: ["r_open"] }, answeredAt: null };
    expect(visibility.hiddenDataRoomFolders).toHaveBeenCalledWith(
      "org_1",
      store.actor,
    );
    expect(db.dataRoomQuestion.count).toHaveBeenCalledWith({ where });
    expect(db.dataRoomQuestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        orderBy: { id: "desc" },
        take: 51,
      }),
    );
    expect(result.count).toBe(3);
    expect(result.hasMore).toBe(false);
    expect(result.questions).toEqual([
      expect.objectContaining({
        id: "q1",
        room: expect.objectContaining({ id: "r_open" }),
      }),
    ]);
  });

  it("asks nothing when the caller runs no room", async () => {
    db.dataRoom.findMany.mockResolvedValue([room("r_hidden", "Board")]);
    visibility.hiddenDataRoomFolders.mockResolvedValue(["Board"]);

    await expect(
      listWaitingDataRoomQuestions(store, { take: 50 }),
    ).resolves.toEqual({ count: 0, questions: [], hasMore: false });
    expect(db.dataRoomQuestion.count).not.toHaveBeenCalled();
    expect(db.dataRoomQuestion.findMany).not.toHaveBeenCalled();
  });

  it("reaches the oldest of 51 questions across rooms by paging, answering none", async () => {
    db.dataRoom.findMany.mockResolvedValue([
      room("r_a", "Series A"),
      room("r_b", "Sale"),
    ]);
    // UUIDv7-like ids: zero-padded, so string order is creation order.
    const all = Array.from({ length: 51 }, (_, index) => ({
      id: `0000-${String(index).padStart(4, "0")}`,
      roomId: index % 2 === 0 ? "r_a" : "r_b",
      answeredAt: null,
      member: { email: `v${index}@example.com`, name: null },
    }));
    type Args = {
      where: { roomId: { in: string[] }; id?: { lt: string } };
      orderBy: { id: "desc" };
      take: number;
    };
    db.dataRoomQuestion.count.mockResolvedValue(all.length);
    db.dataRoomQuestion.findMany.mockImplementation(async (args: Args) =>
      all
        .filter((question) => args.where.roomId.in.includes(question.roomId))
        .filter((question) => !args.where.id || question.id < args.where.id.lt)
        .sort((a, b) => b.id.localeCompare(a.id))
        .slice(0, args.take),
    );

    const first = await listWaitingDataRoomQuestions(store, { take: 50 });
    expect(first.count).toBe(51);
    expect(first.questions).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(first.questions.map((question) => question.id)).not.toContain(
      "0000-0000",
    );

    const second = await listWaitingDataRoomQuestions(store, {
      cursor: first.questions.at(-1)?.id,
      take: 50,
    });
    expect(second.questions.map((question) => question.id)).toEqual([
      "0000-0000",
    ]);
    expect(second.questions[0]?.room.id).toBe("r_a");
    expect(second.hasMore).toBe(false);
    expect(second.count).toBe(51);
  });
});
