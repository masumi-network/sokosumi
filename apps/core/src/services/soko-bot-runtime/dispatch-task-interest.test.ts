import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findFollowers: vi.fn(),
  findTask: vi.fn(),
  deleteFollowers: vi.fn(),
  receipt: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { taskFollower: { findMany: m.findFollowers } },
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: (run: (tx: unknown) => unknown) =>
    run({
      task: { findFirst: m.findTask },
      taskFollower: { deleteMany: m.deleteFollowers },
    }),
}));
vi.mock("@/lib/soko-bot/action-receipts", () => ({
  commitActionReceipt: m.receipt,
}));

import { SokoBotRefusedUnsentError } from "../soko-bot-runtime.service";
import { dispatchTaskInterestTools } from "./dispatch-task-interest";
import type { RuntimeOperations } from "./operations";

const OWNER = "01960001-0001-7001-8001-000000000001";
const TASK_ID = "01960001-0001-7001-8001-0000000000aa";
const runtime = {
  requireMutationAuthority: vi.fn(),
} as unknown as RuntimeOperations;

function authorizedAs(overrides: {
  askedByKind?: "OWNER" | "TEAMMATE" | "ASSISTANT";
  shared?: boolean;
}) {
  return {
    askedByKind: overrides.askedByKind ?? "OWNER",
    turn: {
      id: "turn-1",
      sokoBotId: "bot-1",
      workspaceId: "workspace-1",
      actingUserId: OWNER,
    },
    reader: {
      userId: OWNER,
      audience: "OWNER",
      sharedScope: overrides.shared ? { kind: "workspace" } : null,
    },
  } as never;
}

function call(
  capability: string,
  input: unknown,
  authorized = authorizedAs({}),
) {
  return dispatchTaskInterestTools(
    runtime,
    { capability, input, toolCallId: "call-1", turnId: "turn-1" } as never,
    authorized,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m.findTask.mockResolvedValue({ id: TASK_ID });
  m.deleteFollowers.mockResolvedValue({ count: 1 });
});

describe("Task interest tools", () => {
  it.each([
    ["a teammate's turn", authorizedAs({ askedByKind: "TEAMMATE" })],
    ["another bot's turn", authorizedAs({ askedByKind: "ASSISTANT" })],
    ["a shared bot", authorizedAs({ shared: true })],
  ])("keeps the owner's follows from %s", async (_, authorized) => {
    await expect(
      call("list_followed_tasks", {}, authorized),
    ).rejects.toBeInstanceOf(SokoBotRefusedUnsentError);
    await expect(
      call("stop_following_task", { taskId: TASK_ID }, authorized),
    ).rejects.toBeInstanceOf(SokoBotRefusedUnsentError);
    expect(m.findFollowers).not.toHaveBeenCalled();
    expect(m.deleteFollowers).not.toHaveBeenCalled();
  });

  it("stops following without leaving the Task", async () => {
    await expect(
      call("stop_following_task", { taskId: TASK_ID }),
    ).resolves.toEqual({ taskId: TASK_ID, following: false });
    expect(m.deleteFollowers).toHaveBeenCalledWith({
      where: { taskId: TASK_ID, userId: OWNER },
    });
    expect(m.receipt.mock.calls[0]?.[1]).toMatchObject({
      targetId: TASK_ID,
      disposition: "APPLIED",
    });
  });

  it("reports a Task the owner does not follow as already satisfied", async () => {
    m.deleteFollowers.mockResolvedValue({ count: 0 });
    await call("stop_following_task", { taskId: TASK_ID });
    expect(m.receipt.mock.calls[0]?.[1]).toMatchObject({
      disposition: "ALREADY_SATISFIED",
    });
  });

  it("refuses a Task the owner cannot see and changes nothing", async () => {
    m.findTask.mockResolvedValue(null);
    await expect(
      call("stop_following_task", { taskId: TASK_ID }),
    ).rejects.toThrow("The task was not found");
    expect(m.deleteFollowers).not.toHaveBeenCalled();
    expect(m.receipt).not.toHaveBeenCalled();
  });
});
