import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  dataRoom: { findFirst: vi.fn() },
  dataRoomQuestion: { findMany: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));
vi.mock("@/lib/data-room-visibility", () => ({
  canSeeDataRoom: vi.fn().mockResolvedValue(true),
  hiddenDataRoomFolders: vi.fn().mockResolvedValue([]),
}));
const files = vi.hoisted(() => ({ listDataRoomFiles: vi.fn() }));
vi.mock("@/services/data-room-files.service", () => files);
vi.mock("@/lib/drive-blob", () => ({}));
vi.mock("@vercel/blob", () => ({}));
vi.mock("@/services/data-room-access.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/data-room-access.service")
  >("@/services/data-room-access.service");
  return { memberSeesPath: actual.memberSeesPath };
});
vi.mock("@/services/cmo-brand-media.service", () => ({
  CMO_BRAND_MEDIA_FOLDER: "Brand research",
}));
vi.mock("@/services/image-studio-drive.service", () => ({
  IMAGE_STUDIO_DRIVE_FOLDER: "Content Studio",
}));
vi.mock("@/services/marketing-strategy-files.service", () => ({
  MARKETING_FILES_FOLDER: "Marketing",
}));

import {
  answerDataRoomQuestion,
  listViewerDataRoomQuestions,
} from "./data-room-members.service";

const store = {
  workspaceId: "ws_1",
  scope: "user" as const,
  ownerId: "u_owner",
  actor: { userId: "u_owner", kind: "interactive" as const },
} as Parameters<typeof answerDataRoomQuestion>[0]["store"];

const room = {
  id: "r_1",
  workspaceId: "ws_1",
  sourceScope: "USER",
  ownerId: "u_owner",
  folderPath: "Series A",
} as unknown as Parameters<typeof listViewerDataRoomQuestions>[0]["room"];

function question(
  id: string,
  memberId: string,
  path: string,
  shared: boolean,
  answer: string | null = "Yes",
) {
  return {
    id,
    createdAt: new Date("2026-11-17T10:00:00Z"),
    memberId,
    path,
    body: `Question ${id}`,
    answer,
    answeredAt: answer ? new Date("2026-11-17T11:00:00Z") : null,
    sharedAt: shared ? new Date("2026-11-17T11:00:00Z") : null,
    member: { email: `${memberId}@fund.example`, name: memberId },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.dataRoom.findFirst.mockResolvedValue({
    ...room,
    createdByUserId: "u_owner",
  });
  db.dataRoomQuestion.updateMany.mockResolvedValue({ count: 1 });
  files.listDataRoomFiles.mockResolvedValue([
    { path: "Finance/Model.xlsx" },
    { path: "Legal/Charter.pdf" },
  ]);
});

describe("answerDataRoomQuestion", () => {
  it("shows the answer to the room when the owner shares it", async () => {
    await answerDataRoomQuestion({
      store,
      roomId: "r_1",
      questionId: "q_1",
      answer: "Churn is 2% a month.",
      shared: true,
      userId: "u_owner",
    });
    expect(
      db.dataRoomQuestion.updateMany.mock.calls[0][0].data.sharedAt,
    ).toBeInstanceOf(Date);
  });

  it("takes the answer back to the asker when the owner unshares it", async () => {
    await answerDataRoomQuestion({
      store,
      roomId: "r_1",
      questionId: "q_1",
      answer: "Churn is 2% a month.",
      shared: false,
      userId: "u_owner",
    });
    expect(
      db.dataRoomQuestion.updateMany.mock.calls[0][0].data.sharedAt,
    ).toBeNull();
  });

  it("leaves sharing alone when the caller does not say", async () => {
    await answerDataRoomQuestion({
      store,
      roomId: "r_1",
      questionId: "q_1",
      answer: "Churn is 2% a month.",
      userId: "u_owner",
    });
    expect(
      db.dataRoomQuestion.updateMany.mock.calls[0][0].data,
    ).not.toHaveProperty("sharedAt");
  });
});

describe("listViewerDataRoomQuestions", () => {
  const viewer = { id: "m_me", folderPaths: [] as string[] };

  it("gives a viewer their own questions and shared answers, never who else asked", async () => {
    db.dataRoomQuestion.findMany.mockResolvedValue([
      question("q_mine", "m_me", "Legal/Charter.pdf", false, null),
      question("q_shared", "m_other", "Finance/Model.xlsx", true),
    ]);
    const questions = await listViewerDataRoomQuestions({
      room,
      member: viewer,
    });
    expect(questions).toEqual([
      expect.objectContaining({ id: "q_mine", mine: true, shared: false }),
      {
        id: "q_shared",
        createdAt: "2026-11-17T10:00:00.000Z",
        path: "Finance/Model.xlsx",
        body: "Question q_shared",
        answer: "Yes",
        answeredAt: "2026-11-17T11:00:00.000Z",
        mine: false,
        shared: true,
      },
    ]);
    expect(JSON.stringify(questions)).not.toContain("m_other");
  });

  it("hides shared answers about folders the viewer may not open", async () => {
    db.dataRoomQuestion.findMany.mockResolvedValue([
      question("q_finance", "m_other", "Finance/Model.xlsx", true),
      question("q_legal", "m_other", "Legal/Charter.pdf", true),
    ]);
    const questions = await listViewerDataRoomQuestions({
      room,
      member: { id: "m_me", folderPaths: ["Legal"] },
    });
    expect(questions.map((q) => q.id)).toEqual(["q_legal"]);
  });

  it("hides shared answers about documents no longer in the room", async () => {
    db.dataRoomQuestion.findMany.mockResolvedValue([
      question("q_gone", "m_other", "Finance/Old model.xlsx", true),
    ]);
    const questions = await listViewerDataRoomQuestions({
      room,
      member: viewer,
    });
    expect(questions).toEqual([]);
  });

  it("asks the database only for the viewer's own or answered shared questions", async () => {
    db.dataRoomQuestion.findMany.mockResolvedValue([]);
    await listViewerDataRoomQuestions({
      room,
      member: viewer,
      path: "Legal/Charter.pdf",
    });
    expect(db.dataRoomQuestion.findMany.mock.calls[0][0].where).toEqual({
      roomId: "r_1",
      path: "Legal/Charter.pdf",
      OR: [
        { memberId: "m_me" },
        { sharedAt: { not: null }, answer: { not: null } },
      ],
    });
  });
});
