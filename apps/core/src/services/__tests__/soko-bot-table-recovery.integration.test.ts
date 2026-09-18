import { createHash, randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";
import prisma from "@/lib/db/prisma";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeService,
} from "@/services/soko-bot-runtime.service";

const userId = randomUUID(),
  workspaceId = randomUUID(),
  sokoBotId = randomUUID();
const capabilities = [
  "create_table",
  "write_table_rows",
  "update_table_columns",
] as const;
describe.runIf(process.env.RUN_DATABASE_INTEGRATION_TESTS === "true")(
  "R2 durable table runtime recovery",
  () => {
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        !url.pathname.includes("native_tables")
      )
        throw Error("Own isolated database required");
      await prisma.user.create({
        data: {
          id: userId,
          name: "Receipt fixture",
          email: `${userId}@fixture.invalid`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await prisma.workspace.create({ data: { id: workspaceId, userId } });
      await prisma.sokoBot.create({
        data: { id: sokoBotId, userId, workspaceId },
      });
    });
    afterEach(() => vi.restoreAllMocks());
    afterAll(async () => {
      await prisma.chatRoom.deleteMany({ where: { createdByUserId: userId } });
      await prisma.workspace.delete({ where: { id: workspaceId } });
      await prisma.user.delete({ where: { id: userId } });
      await prisma.$disconnect();
    });
    async function setup() {
      const turn = await prisma.sokoBotTurn.create({
        data: {
          userId,
          workspaceId,
          sokoBotId,
          source: "CHAT",
          clientTurnId: randomUUID(),
          userMessage: "Research",
          capabilityNames: [...capabilities],
          deadlineAt: new Date(Date.now() + 60000),
          eveSessionId: randomUUID(),
        },
      });
      const authorized: AuthorizedSokoBotRuntime = {
        turn,
        classificationConfidence: 1,
        grant: {
          userId,
          workspaceId,
          sokoBotId,
          issuer: "test",
          audience: "test",
          subject: sokoBotId,
          jwtId: randomUUID(),
          sessionId: turn.eveSessionId!,
          turnId: turn.id,
          contextSnapshotId: randomUUID(),
          memoryRevisionId: null,
          memoryVersion: 0,
          capabilities: [...capabilities],
          issuedAt: 0,
          expiresAt: 9999999999,
        },
      };
      const runtime = new SokoBotRuntimeService();
      const authorize = vi
        .spyOn(runtime, "authorize")
        .mockResolvedValue(authorized);
      const request = {
        turnId: turn.id,
        sessionId: turn.eveSessionId!,
        toolCallId: randomUUID(),
      };
      return { runtime, authorize, request, turn };
    }
    const createdSchema = z.object({
      table: z.object({
        id: z.uuid(),
        columns: z.array(z.object({ id: z.uuid() })),
      }),
      url: z.string(),
    });
    function createInput() {
      return {
        key: randomUUID(),
        title: "Recovery",
        columns: [{ id: randomUUID(), name: "Company", type: "text" }],
      };
    }
    it.each(capabilities)(
      "recovers %s after receipt failure without duplicate changes",
      async (capability) => {
        const { runtime, authorize, request } = await setup();
        const initial = createdSchema.parse(
          await runtime.executeTool({
            ...request,
            toolCallId: randomUUID(),
            capability: "create_table",
            input: createInput(),
          }),
        );
        const input =
          capability === "create_table"
            ? createInput()
            : capability === "write_table_rows"
              ? {
                  tableId: initial.table.id,
                  key: randomUUID(),
                  insert: [
                    { values: { [initial.table.columns[0].id]: "Acme" } },
                  ],
                }
              : {
                  tableId: initial.table.id,
                  key: randomUUID(),
                  version: 1,
                  columns: [
                    {
                      id: initial.table.columns[0].id,
                      name: "Renamed",
                      type: "text",
                    },
                  ],
                };
        const call = { ...request, capability, input };
        const receipt = vi
          .spyOn(prisma.sokoBotToolCall, "update")
          .mockRejectedValueOnce(new Error("receipt interrupted"));
        await expect(runtime.executeTool(call)).rejects.toThrow(
          "receipt interrupted",
        );
        receipt.mockRestore();
        const where = {
          turnId_toolCallId: {
            turnId: request.turnId,
            toolCallId: request.toolCallId,
          },
        };
        expect(
          (await prisma.sokoBotToolCall.findUniqueOrThrow({ where })).status,
        ).toBe("FAILED");
        const counts = async () => [
          await prisma.dataTable.count({ where: { workspaceId } }),
          await prisma.tableRow.count({ where: { tableId: initial.table.id } }),
          await prisma.tableChange.count({
            where: { tableId: initial.table.id },
          }),
        ];
        const before = await counts();
        await expect(
          runtime.executeTool({
            ...call,
            input: { ...input, key: randomUUID() },
          }),
        ).rejects.toThrow("different input");
        await expect(
          runtime.executeTool({ ...call, capability: "read_table" }),
        ).rejects.toThrow("different input");
        authorize.mockRejectedValueOnce(new Error("grant revoked"));
        await expect(runtime.executeTool(call)).rejects.toThrow(
          "grant revoked",
        );
        const result = await runtime.executeTool(call);
        expect(await runtime.executeTool(call)).toEqual(result);
        expect(await counts()).toEqual(before);
        expect(
          (await prisma.sokoBotToolCall.findUniqueOrThrow({ where })).status,
        ).toBe("COMPLETED");
        if (capability === "create_table") {
          const recovered = createdSchema.parse(result);
          expect(recovered.url).toBe(`/drive/tables/${recovered.table.id}`);
          expect(
            await prisma.dataTable.findUnique({
              where: { id: recovered.table.id },
            }),
          ).not.toBeNull();
        } else if (capability === "write_table_rows") {
          const recovered = z
            .object({
              batchId: z.uuid(),
              rows: z.array(z.object({ id: z.uuid() })),
            })
            .parse(result);
          expect(
            await prisma.tableRow.findUnique({
              where: { id: recovered.rows[0].id },
            }),
          ).not.toBeNull();
          expect(recovered.rows).toHaveLength(1);
        } else {
          expect(result).toMatchObject({
            id: initial.table.id,
            version: 2,
            columns: [expect.objectContaining({ name: "Renamed" })],
          });
        }
      },
    );
    it.each([false, true])(
      "recovers publication failure (already published: %s)",
      async (published) => {
        const { runtime, request, turn } = await setup();
        const room = await prisma.chatRoom.create({
          data: {
            name: "Recovery",
            kind: "direct",
            createdByUserId: userId,
            directKey: randomUUID(),
          },
        });
        const message = await prisma.chatRoomMessage.create({
          data: { roomId: room.id, content: "Research", senderUserId: userId },
        });
        const mention = await prisma.chatRoomMention.create({
          data: { messageId: message.id, sokoBotId },
        });
        await prisma.sokoBotTurn.update({
          where: { id: turn.id },
          data: { chatMentionId: mention.id },
        });
        let first = true;
        const post = vi
          .spyOn(runtime, "postChat")
          .mockImplementation(async (_authorized, body) => {
            if (first && !published) {
              first = false;
              throw Error("publication interrupted");
            }
            const linked = await prisma.chatRoomMessage.create({
              data: {
                roomId: room.id,
                content: body.content,
                senderSokoBotId: sokoBotId,
              },
            });
            if (first) {
              first = false;
              throw Error("publication interrupted");
            }
            return {
              messageId: linked.id,
              roomId: room.id,
              postedAt: linked.createdAt.toISOString(),
              summoned: 0,
            };
          });
        const call = {
          ...request,
          capability: "create_table" as const,
          input: createInput(),
        };
        await expect(runtime.executeTool(call)).rejects.toThrow(
          "publication interrupted",
        );
        const count = await prisma.dataTable.count({ where: { workspaceId } });
        const result = createdSchema.parse(await runtime.executeTool(call));
        expect(await prisma.dataTable.count({ where: { workspaceId } })).toBe(
          count,
        );
        const links = await prisma.chatRoomMessage.findMany({
          where: { roomId: room.id, senderSokoBotId: sokoBotId },
        });
        expect(links).toHaveLength(1);
        expect(links[0].content).toContain(result.url);
        expect(
          await prisma.dataTable.findUnique({ where: { id: result.table.id } }),
        ).not.toBeNull();
        expect(post).toHaveBeenCalledTimes(published ? 1 : 2);
      },
    );
    it("never replays a failed non-table side effect", async () => {
      const { runtime, request } = await setup();
      const input = { roomId: randomUUID(), content: "Do not send twice" };
      await prisma.sokoBotToolCall.create({
        data: {
          turnId: request.turnId,
          toolCallId: request.toolCallId,
          capability: "post_chat",
          inputHash: createHash("sha256")
            .update(JSON.stringify(input))
            .digest("hex"),
          status: "FAILED",
        },
      });
      const post = vi.spyOn(runtime, "postChat");
      await expect(
        runtime.executeTool({ ...request, capability: "post_chat", input }),
      ).rejects.toThrow("previously failed");
      expect(post).not.toHaveBeenCalled();
    });
    it("does not steal a currently executing table receipt", async () => {
      const { runtime, request } = await setup();
      const input = createInput();
      await prisma.sokoBotToolCall.create({
        data: {
          turnId: request.turnId,
          toolCallId: request.toolCallId,
          capability: "create_table",
          inputHash: createHash("sha256")
            .update(JSON.stringify(input))
            .digest("hex"),
          status: "PENDING",
        },
      });
      const before = await prisma.dataTable.count({ where: { workspaceId } });
      await expect(
        runtime.executeTool({ ...request, capability: "create_table", input }),
      ).rejects.toThrow("already executing");
      expect(await prisma.dataTable.count({ where: { workspaceId } })).toBe(
        before,
      );
    });
  },
);
