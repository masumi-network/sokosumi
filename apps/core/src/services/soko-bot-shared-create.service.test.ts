import { PrismaRaw } from "@sokosumi/database/client";
import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { calls, transactionMock, workspaceFindUniqueMock } = vi.hoisted(() => ({
  calls: [] as string[],
  transactionMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findUnique: workspaceFindUniqueMock },
    $transaction: transactionMock,
  },
}));

vi.mock("@/services/soko-bot-version.service", () => ({
  getDefaultSokoBotVersionId: vi.fn().mockResolvedValue("v1"),
}));

const { assignCodeMock } = vi.hoisted(() => ({ assignCodeMock: vi.fn() }));
vi.mock("@/services/soko-bot-avatar-code.service", () => ({
  giveNewSokoBotAvatar: assignCodeMock.mockResolvedValue(null),
}));

vi.mock("@/services/soko-bot-proactive.service", () => ({
  ensureSystemSchedules: vi.fn().mockResolvedValue(undefined),
}));

import { CUSO_FACE_URL } from "@/lib/cuso-face";
import { createSharedSokoBot } from "./soko-bot-shared-create.service";

const BOT_ID = "01960001-0001-7001-8001-000000000099";

function recordingTx(
  members: string[],
  sameVersionBot: { name: string } | null = null,
) {
  const record =
    <T>(name: string, value: T) =>
    async () => {
      calls.push(name);
      return value;
    };
  return {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const { sql } = PrismaRaw.sql(strings, ...values);
      calls.push(`queryRaw:${sql.trim()}`);
      return sql.includes('FROM "public"."member"')
        ? members.map((userId) => ({ userId }))
        : [{ id: "project_1" }];
    },
    sokoBot: {
      findFirst: record("sokoBot.findFirst", sameVersionBot),
      create: record("sokoBot.create", { id: BOT_ID }),
      update: record("sokoBot.update", { id: BOT_ID, sharedRoomId: "room" }),
    },
    sokoBotMemoryRevision: { create: record("memoryRevision.create", {}) },
    chatRoom: { create: record("chatRoom.create", { id: "room" }) },
  };
}

describe("createSharedSokoBot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    workspaceFindUniqueMock.mockResolvedValue({ organizationId: "org_1" });
  });

  it("locks the organization, then the workspace, in READ COMMITTED, then key-share locks the members", async () => {
    const tx = recordingTx(["caller"]);
    transactionMock.mockImplementation(async (run) => await run(tx));

    await createSharedSokoBot({
      callerUserId: "caller",
      workspaceId: "workspace_1",
      projectId: null,
      name: "Team",
    });

    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "ReadCommitted",
    });
    expect(calls[0]).toMatch(
      /^queryRaw:SELECT "id" FROM "public"\."organization"\s+WHERE "id" = \?\s+FOR NO KEY UPDATE$/,
    );
    expect(calls[1]).toMatch(
      /^queryRaw:SELECT 1 FROM "public"\."workspace"\s+WHERE "id" = \?::uuid\s+FOR KEY SHARE$/,
    );
    expect(calls[2]).toMatch(
      /^queryRaw:SELECT "userId" FROM "public"\."member"\s+WHERE "organizationId" = \?\s+ORDER BY "createdAt"\s+FOR KEY SHARE$/,
    );
    expect(calls.slice(3)).toEqual([
      "sokoBot.create",
      "memoryRevision.create",
      "chatRoom.create",
      "sokoBot.update",
    ]);
  });

  it("gives the bot a random avatar code when no look was picked", async () => {
    const tx = recordingTx(["caller"]);
    transactionMock.mockImplementation(async (run) => await run(tx));

    await createSharedSokoBot({
      callerUserId: "caller",
      workspaceId: "workspace_1",
      projectId: null,
      name: "Team",
    });

    expect(assignCodeMock).toHaveBeenCalledWith(BOT_ID, undefined);
  });

  it("refuses a workspace without an organization before any transaction", async () => {
    workspaceFindUniqueMock.mockResolvedValue({ organizationId: null });

    await expect(
      createSharedSokoBot({
        callerUserId: "caller",
        workspaceId: "workspace_1",
        projectId: null,
        name: "Team",
      }),
    ).rejects.toThrow("A shared Soko Bot needs an organization workspace");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("refuses a second live bot of a product's version in one Project, after locking the Project", async () => {
    const tx = recordingTx(["caller"], { name: "Cuso" });
    transactionMock.mockImplementation(async (run) => await run(tx));

    await expect(
      createSharedSokoBot({
        callerUserId: "caller",
        workspaceId: "workspace_1",
        projectId: "project_1",
        name: "Cuso",
        versionId: CMO_SOKO_BOT_VERSION_ID,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "This Project already has Cuso",
    });
    expect(calls[3]).toMatch(/^queryRaw:UPDATE "public"\."project"/);
    expect(calls[4]).toBe("sokoBot.findFirst");
    expect(calls).not.toContain("sokoBot.create");
  });

  it("makes a product's bot in a Project that has none", async () => {
    const tx = recordingTx(["caller"]);
    transactionMock.mockImplementation(async (run) => await run(tx));

    await createSharedSokoBot({
      callerUserId: "caller",
      workspaceId: "workspace_1",
      projectId: "project_1",
      name: "Cuso",
      versionId: CMO_SOKO_BOT_VERSION_ID,
    });

    expect(calls).toContain("sokoBot.create");
  });

  it("gives a new Cuso his fixed face instead of a random look", async () => {
    const tx = recordingTx(["caller"]);
    const create = vi.spyOn(tx.sokoBot, "create");
    transactionMock.mockImplementation(async (run) => await run(tx));

    await createSharedSokoBot({
      callerUserId: "caller",
      workspaceId: "workspace_1",
      projectId: "project_1",
      name: "Cuso",
      versionId: CMO_SOKO_BOT_VERSION_ID,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ avatarImageUrl: CUSO_FACE_URL }),
    });
    expect(assignCodeMock).not.toHaveBeenCalled();
  });

  it("lets a Project hold several bots of any other pinned version", async () => {
    const tx = recordingTx(["caller"], { name: "Writer" });
    transactionMock.mockImplementation(async (run) => await run(tx));

    await createSharedSokoBot({
      callerUserId: "caller",
      workspaceId: "workspace_1",
      projectId: "project_1",
      name: "Writer",
      versionId: "writer-v1",
    });

    expect(calls).toContain("sokoBot.create");
  });

  it("refuses a caller who is not among the locked members", async () => {
    const tx = recordingTx(["someone_else"]);
    transactionMock.mockImplementation(async (run) => await run(tx));

    await expect(
      createSharedSokoBot({
        callerUserId: "caller",
        workspaceId: "workspace_1",
        projectId: null,
        name: "Team",
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(calls).not.toContain("sokoBot.create");
  });
});
