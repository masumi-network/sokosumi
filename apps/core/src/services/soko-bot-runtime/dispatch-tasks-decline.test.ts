import { beforeEach, describe, expect, it, vi } from "vitest";

const { askJevMock } = vi.hoisted(() => ({ askJevMock: vi.fn() }));
vi.mock("@/lib/soko-bot/jev", async (original) => ({
  ...(await original<typeof import("@/lib/soko-bot/jev")>()),
  askJev: askJevMock,
}));

import { dispatchTasksTools } from "./dispatch-tasks";

const COWORKER = "coworker-one";

function failedTask(
  events: { status: string; coworkerId?: string; userId?: string }[],
  assignee: {
    assigneeCoworkerId?: string | null;
    assigneeUserId?: string | null;
  } = { assigneeCoworkerId: COWORKER },
) {
  return {
    id: "task-one",
    status: "FAILED",
    assigneeCoworkerId: null,
    assigneeUserId: null,
    ...assignee,
    events: events.map((event, index) => ({
      id: `event-${index}`,
      status: event.status,
      author: {
        coworkerId: event.coworkerId ?? null,
        userId: event.userId ?? null,
        sokoBotId: null,
      },
    })),
  };
}

async function reply(task: unknown, versionId = "v40-e13") {
  const runtime = {
    readTask: vi.fn(async () => task),
    replyToTask: vi.fn(),
  };
  const turn = {
    id: "turn",
    sokoBotId: "bot",
    versionId,
    workspaceId: "workspace-one",
    actingUserId: "owner-one",
    source: "EVENT",
    chainDepth: 0,
  };
  const message = await dispatchTasksTools(
    runtime as never,
    {
      turnId: turn.id,
      capability: "reply_to_task",
      toolCallId: "reply",
      input: { taskId: "task-one", comment: "Please take this up again." },
    } as never,
    {
      turn,
      askedByKind: "OWNER",
      reader: { userId: "owner-one", audience: "OWNER" },
    } as never,
  ).then(
    () => "",
    (error: Error) => error.message,
  );
  return { message, runtime };
}

describe("reply_to_task on a failed Task (E13)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    askJevMock.mockResolvedValue(new Map([["chases", 0.9]]));
  });

  it("names the owner's options when the Task's own Coworker set it FAILED", async () => {
    const { message, runtime } = await reply(
      failedTask([
        { status: "READY", userId: "owner-one" },
        { status: "FAILED", coworkerId: COWORKER },
      ]),
    );
    expect(message).toMatch(/Coworker set it FAILED/);
    expect(runtime.readTask).toHaveBeenCalledWith(
      expect.anything(),
      "task-one",
    );
    expect(runtime.replyToTask).not.toHaveBeenCalled();
  });

  it("holds a chase on the owner's failed Task without inventing a Coworker refusal", async () => {
    const { message, runtime } = await reply(
      failedTask([{ status: "FAILED", userId: "owner-one" }], {
        assigneeUserId: "owner-one",
        assigneeCoworkerId: null,
      }),
    );
    expect(message).toMatch(/Not posted/);
    expect(message).not.toMatch(/turned down/);
    expect(runtime.replyToTask).not.toHaveBeenCalled();
  });

  it("is not a decline when someone other than the assigned Coworker failed it", async () => {
    const { message } = await reply(
      failedTask([{ status: "FAILED", userId: "owner-one" }]),
    );
    expect(message).toMatch(/status update/);
  });

  it("is not a decline when Core's Task read cannot see the Task", async () => {
    const { message } = await reply(null);
    expect(message).toMatch(/status update/);
  });

  it("never reads the Task for a version without declineOptions", async () => {
    const { message, runtime } = await reply(
      failedTask([{ status: "FAILED", coworkerId: COWORKER }]),
      "v40",
    );
    expect(message).toMatch(/status update/);
    expect(runtime.readTask).not.toHaveBeenCalled();
  });
});
