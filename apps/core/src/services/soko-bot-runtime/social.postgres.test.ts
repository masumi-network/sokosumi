import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import prisma from "@/lib/db/prisma";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeService,
} from "../soko-bot-runtime.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const ownerId = randomUUID();
const foreignOwnerId = randomUUID();
const workspaceId = randomUUID();
const foreignWorkspaceId = randomUUID();
const sokoBotId = randomUUID();
const marketingId = randomUUID();
const outreachId = randomUUID();
const foreignProjectId = randomUUID();
const capabilities = [
  "list_project_social_accounts",
  "get_posting_instructions",
  "list_social_posts",
] as const;

describe.skipIf(!enabled)("social read Project identity", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      throw new Error("An isolated local database is required");
    for (const id of [ownerId, foreignOwnerId])
      await prisma.user.create({
        data: {
          id,
          name: "Project identity fixture",
          email: `${id}@fixture.invalid`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    await prisma.workspace.createMany({
      data: [
        { id: workspaceId, userId: ownerId },
        { id: foreignWorkspaceId, userId: foreignOwnerId },
      ],
    });
    await prisma.sokoBot.create({
      data: { id: sokoBotId, userId: ownerId, workspaceId },
    });
    await prisma.project.createMany({
      data: [
        { id: marketingId, workspaceId, name: "Sokosumi Marketing" },
        { id: outreachId, workspaceId, name: "utxo AG Outreach" },
        {
          id: foreignProjectId,
          workspaceId: foreignWorkspaceId,
          name: "Private Project",
        },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceId, foreignWorkspaceId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, foreignOwnerId] } },
    });
  });

  async function reader() {
    const sessionId = randomUUID();
    const turn = await prisma.sokoBotTurn.create({
      data: {
        sokoBotId,
        requestedByUserId: ownerId,
        workspaceId,
        source: "CHAT",
        status: "RUNNING",
        versionId: "v38",
        clientTurnId: randomUUID(),
        eveSessionId: sessionId,
        userMessage: "Draft an X post for Sokosumi Marketing.",
        capabilityNames: [...capabilities],
        deadlineAt: new Date(Date.now() + 60_000),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    const authorized: AuthorizedSokoBotRuntime = {
      turn: { ...turn, actingUserId: ownerId },
      classificationConfidence: 1,
      askedByKind: "OWNER",
      toolCallLimit: 64,
      reader: { userId: ownerId, audience: "OWNER", sharedScope: null },
      grant: {
        userId: ownerId,
        workspaceId,
        sokoBotId,
        issuer: "test",
        audience: "test",
        subject: sokoBotId,
        jwtId: randomUUID(),
        sessionId,
        turnId: turn.id,
        contextSnapshotId: randomUUID(),
        memoryRevisionId: null,
        memoryVersion: 0,
        capabilities,
        issuedAt: 0,
        expiresAt: 9999999999,
      },
    };
    const runtime = new SokoBotRuntimeService();
    // Supply authenticated claims at the auth boundary; all Project/owner reads use PostgreSQL.
    vi.spyOn(runtime, "authorize").mockResolvedValue(authorized);
    return (capability: (typeof capabilities)[number], projectId: string) =>
      runtime.executeTool({
        sessionId,
        turnId: turn.id,
        toolCallId: randomUUID(),
        capability,
        input: { projectId },
      });
  }

  it.each(capabilities)(
    "labels empty %s results with the exact queried Project",
    async (capability) => {
      const read = await reader();
      const result = await read(capability, outreachId);
      expect(result).toMatchObject({
        project: { id: outreachId, name: "utxo AG Outreach" },
        instruction: expect.stringContaining("only this Project"),
      });
      if (capability === "list_project_social_accounts")
        expect(result).toMatchObject({ accounts: [] });
      if (capability === "list_social_posts")
        expect(result).toMatchObject({ posts: [] });
      if (capability === "get_posting_instructions")
        expect(result).toMatchObject({ postingInstructionsMd: null });
      expect(await read(capability, marketingId)).toMatchObject({
        project: { id: marketingId, name: "Sokosumi Marketing" },
      });
    },
  );

  it.each(capabilities)(
    "does not return foreign Project identity through %s",
    async (capability) => {
      const read = await reader();
      await expect(read(capability, foreignProjectId)).rejects.toThrow(
        /Project/,
      );
    },
  );

  it("keeps a Project bot pinned instead of retargeting its read", async () => {
    await prisma.sokoBot.update({
      where: { id: sokoBotId },
      data: { userId: null, projectId: marketingId },
    });
    try {
      const read = await reader();
      await expect(
        read("list_project_social_accounts", outreachId),
      ).rejects.toThrow("This bot works in its own Project only");
    } finally {
      await prisma.sokoBot.update({
        where: { id: sokoBotId },
        data: { userId: ownerId, projectId: null },
      });
    }
  });
});
