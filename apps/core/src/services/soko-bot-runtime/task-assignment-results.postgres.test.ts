import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { SokoBotRuntimeService } from "../soko-bot-runtime.service";

vi.mock("@/lib/ably/publish", () => ({
  publishTaskEventData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/helpers/task-notifications", () => ({
  notifyTaskStatusEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@vercel/functions", () => ({
  attachDatabasePool: vi.fn(),
  waitUntil: vi.fn(),
}));

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const TURN_LIFETIME_MS = 60_000;
const userId = `task-owner-${randomUUID()}`;
const workspaceId = randomUUID();
const sokoBotId = randomUUID();
const coworkerId = randomUUID();
const vendorId = randomUUID();
const service = new SokoBotRuntimeService();

describe.runIf(enabled)(
  "task mutation assignment results against PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.create({
        data: {
          id: userId,
          name: "Task result owner",
          email: `${userId}@fixture.invalid`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await prisma.workspace.create({ data: { id: workspaceId, userId } });
      await prisma.sokoBot.create({
        data: { id: sokoBotId, userId, workspaceId, status: "RUNNING" },
      });
      await prisma.vendor.create({
        data: { id: vendorId, name: "Task result vendor", slug: vendorId },
      });
      await prisma.coworker.create({
        data: {
          id: coworkerId,
          slug: coworkerId,
          name: "Task result Coworker",
          vendorId,
          capabilities: ["tasks"],
          isWhitelisted: true,
        },
      });
    });

    afterAll(async () => {
      await prisma.task.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.coworker.deleteMany({ where: { id: coworkerId } });
      await prisma.vendor.deleteMany({ where: { id: vendorId } });
      await prisma.$disconnect();
    });

    async function callInput(
      capability: "create_task" | "assign_task",
      input: object,
    ) {
      const turn = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId,
          requestedByUserId: userId,
          workspaceId,
          source: "CHAT",
          status: "RUNNING",
          clientTurnId: randomUUID(),
          userMessage: "Assign the research task",
          capabilityNames: [capability],
          deadlineAt: new Date(Date.now() + TURN_LIFETIME_MS),
          leaseExpiresAt: new Date(Date.now() + TURN_LIFETIME_MS),
          contextSnapshot: {
            create: {
              generatedAt: new Date(),
              schemaVersion: 1,
              hash: "assignment-result-fixture",
              packet: { memory: { version: 0 } },
              byteSize: 0,
              tokenEstimate: 0,
              counts: {},
              omissions: {},
            },
          },
        },
      });
      return {
        sessionId: `session-${turn.id}`,
        turnId: turn.id,
        capability,
        toolCallId: randomUUID(),
        input,
      };
    }

    const assignments = [
      {
        name: "human",
        input: { memberId: userId },
        expected: {
          assigneeId: null,
          assigneeCoworkerId: null,
          assigneeUserId: userId,
          assigneeSokoBotId: null,
        },
      },
      {
        name: "Coworker",
        input: { coworkerId },
        expected: {
          assigneeId: coworkerId,
          assigneeCoworkerId: coworkerId,
          assigneeUserId: null,
          assigneeSokoBotId: null,
        },
      },
      {
        name: "Soko Bot",
        input: { coworkerId: sokoBotId },
        expected: {
          assigneeId: null,
          assigneeCoworkerId: null,
          assigneeUserId: null,
          assigneeSokoBotId: sokoBotId,
        },
      },
      {
        name: "unassigned",
        input: {},
        expected: {
          assigneeId: null,
          assigneeCoworkerId: null,
          assigneeUserId: null,
          assigneeSokoBotId: null,
        },
      },
    ];

    describe.each(["create_task", "assign_task"] as const)(
      "%s",
      (capability) => {
        it.each(
          assignments.filter(
            ({ name }) => capability === "create_task" || name !== "unassigned",
          ),
        )(
          "reports the stored $name assignment and retains it on receipt replay",
          async ({ name, input: assignment, expected }) => {
            const status = name === "unassigned" ? "DRAFT" : "READY";
            const task =
              capability === "assign_task"
                ? await prisma.task.create({
                    data: {
                      name: "Assignment result",
                      ownerId: userId,
                      creatorUserId: userId,
                      workspaceId,
                      status: "DRAFT",
                    },
                  })
                : null;
            const input = await callInput(capability, {
              ...assignment,
              ...(task
                ? { taskId: task.id, ready: status === "READY" }
                : { name: "Assignment result", status }),
            });
            const result = await service.executeTool(input);
            expect(result).toMatchObject({ status, ...expected });
            const receipt = await prisma.sokoBotToolCall.findUniqueOrThrow({
              where: {
                turnId_toolCallId: {
                  turnId: input.turnId,
                  toolCallId: input.toolCallId,
                },
              },
            });
            expect(receipt.result).toEqual(result);
            const stored = await prisma.task.findUniqueOrThrow({
              where: { id: receipt.targetId! },
            });
            expect(stored).toMatchObject({
              status,
              assigneeId: expected.assigneeCoworkerId,
              assigneeUserId: expected.assigneeUserId,
              assigneeSokoBotId: expected.assigneeSokoBotId,
            });
            expect(await service.executeTool(input)).toEqual(result);
          },
        );
      },
    );
  },
);
