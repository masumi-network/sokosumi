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

vi.mock("@/services/soko-bot-proactive.service", () => ({
  ensureSystemSchedules: vi.fn().mockResolvedValue(undefined),
}));

import {
  createSharedSokoBot,
  sharedSokoBotRoomSlug,
} from "./soko-bot-shared-create.service";

const BOT_ID = "01960001-0001-7001-8001-000000000099";

function recordingTx(members: string[]) {
  const record =
    <T>(name: string, value: T) =>
    async (...args: unknown[]) => {
      const first = args[0];
      calls.push(
        Array.isArray(first) ? `${name}:${first.join("?").trim()}` : name,
      );
      return value;
    };
  return {
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) =>
      await record(
        "queryRaw",
        sql.join("").includes('FROM "member"')
          ? members.map((userId) => ({ userId }))
          : [{ id: "project_1" }],
      )(sql, ...values),
    sokoBot: {
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
      /^queryRaw:SELECT "id" FROM "organization"\s+WHERE "id" = \?\s+FOR NO KEY UPDATE$/,
    );
    expect(calls[1]).toMatch(
      /^queryRaw:SELECT 1 FROM "workspace"\s+WHERE "id" = \?::uuid\s+FOR KEY SHARE$/,
    );
    expect(calls[2]).toMatch(
      /^queryRaw:SELECT "userId" FROM "member"\s+WHERE "organizationId" = \?\s+ORDER BY "createdAt"\s+FOR KEY SHARE$/,
    );
    expect(calls.slice(3)).toEqual([
      "sokoBot.create",
      "memoryRevision.create",
      "chatRoom.create",
      "sokoBot.update",
    ]);
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

describe("sharedSokoBotRoomSlug", () => {
  it("ends with the bot id and keeps a readable head", () => {
    expect(sharedSokoBotRoomSlug("Launch Team!", BOT_ID)).toBe(
      `launch-team-${BOT_ID}`,
    );
  });

  it("falls back to bot when the name has nothing slug-safe", () => {
    expect(sharedSokoBotRoomSlug("!!!", BOT_ID)).toBe(`bot-${BOT_ID}`);
  });
});
