import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, model } = vi.hoisted(() => ({
  db: {
    task: { findFirst: vi.fn() },
    project: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    sokoBotToolCall: { count: vi.fn() },
  },
  model: { askSmallModel: vi.fn() },
}));

vi.mock("@/lib/db/prisma", () => ({ default: db }));
vi.mock("@/lib/soko-bot/small-model", () => model);
vi.mock("../soko-bot-runtime.service", () => ({
  SokoBotRuntimeAuthorizationError: class extends Error {},
  SokoBotRuntimeValidationError: class extends Error {},
}));

import {
  composeHandoff,
  describeReply,
  guardPrivateData,
} from "./chat-message-handoff";

const authorized = {
  turn: { workspaceId: "ws-1", actingUserId: "robin" },
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue({ name: "Robin Keller" });
});

describe("composeHandoff", () => {
  it("leaves a quick question as it is", async () => {
    model.askSmallModel.mockResolvedValue({
      output: { handoff: false, goal: "", deliverable: "", deadline: "" },
      costUsd: 0,
    });
    expect(
      await composeHandoff(authorized, { message: "What does it cost?" }),
    ).toEqual({ message: "What does it cost?", handoff: false });
  });

  it("adds the request block itself when a plain message hands work over", async () => {
    model.askSmallModel.mockResolvedValue({
      output: {
        handoff: true,
        goal: "Langdock plan comparison",
        deliverable: "a short table",
        deadline: "Friday",
      },
      costUsd: 0,
    });
    const { message, handoff } = await composeHandoff(authorized, {
      message:
        "Could you put together a short table of Langdock's plans by Friday?",
    });
    expect(handoff).toBe(true);
    expect(message).toContain("- Goal: Langdock plan comparison");
    expect(message).toContain("- What I need back: a short table");
    expect(message).toContain("- By: Friday");
  });

  it("sends the words as written when the reading fails", async () => {
    model.askSmallModel.mockRejectedValue(new Error("down"));
    expect(
      await composeHandoff(authorized, { message: "Make me a table." }),
    ).toEqual({ message: "Make me a table.", handoff: false });
  });

  it("adds a request block with who it is for and the public Task it is about", async () => {
    db.task.findFirst.mockResolvedValue({
      name: "Board deck",
      status: "RUNNING",
      description: "Slides for the March board meeting.",
      visibility: "PUBLIC",
    });
    const { message: text } = await composeHandoff(authorized, {
      message: "Could you compare Langdock's plans?",
      request: {
        goal: "A plan comparison",
        deliverable: "A short table",
        deadline: "Friday",
      },
      taskId: "task-1",
    });
    expect(text).toContain("Could you compare Langdock's plans?\n\nRequest");
    expect(text).toContain("- Goal: A plan comparison");
    expect(text).toContain(
      '- Background: for Robin Keller. Task "Board deck" (running): Slides for the March board meeting.',
    );
    expect(text).toContain("- What I need back: A short table");
    expect(text).toContain("- By: Friday");
  });

  it("names a private Task without its contents", async () => {
    db.task.findFirst.mockResolvedValue({
      name: "Salary bands",
      status: "RUNNING",
      description: "Confidential numbers",
      visibility: "PRIVATE",
    });
    const { message: text } = await composeHandoff(authorized, {
      message: "Can you help?",
      request: { goal: "Help" },
      taskId: "task-2",
    });
    expect(text).not.toContain("Salary");
    expect(text).not.toContain("Confidential");
    expect(text).toContain("a private Task of the person I work for");
  });

  it("refuses an id that is not one, without asking the database", async () => {
    await expect(
      composeHandoff(authorized, {
        message: "x",
        projectId: "sokosumi-marketing",
      }),
    ).rejects.toThrow(/No Project with that projectId/);
    expect(db.project.findFirst).not.toHaveBeenCalled();
  });

  it("refuses a Task or Project that is not in this workspace", async () => {
    db.task.findFirst.mockResolvedValue(null);
    await expect(
      composeHandoff(authorized, {
        message: "x",
        taskId: "elsewhere",
      }),
    ).rejects.toThrow(/No Task with that taskId/);
  });
});

describe("guardPrivateData", () => {
  const input = {
    turnIds: ["turn-1"],
    ownerRequest: "Ask Mira for Langdock's prices.",
    message: "Acme's CFO wrote on Monday that their budget is €40k.",
  };

  it("does not check a conversation that read no mail or calendar", async () => {
    db.sokoBotToolCall.count.mockResolvedValue(0);
    await guardPrivateData(input);
    expect(model.askSmallModel).not.toHaveBeenCalled();
  });

  it("refuses private mail content the owner did not ask to share", async () => {
    db.sokoBotToolCall.count.mockResolvedValue(2);
    model.askSmallModel.mockResolvedValue({
      output: { sharesPrivate: true, what: "an email from Acme's CFO" },
      costUsd: 0,
    });
    await expect(guardPrivateData(input)).rejects.toThrow(
      /private mail or calendar \(an email from Acme's CFO\)/,
    );
  });

  it("fails closed when the check cannot answer", async () => {
    db.sokoBotToolCall.count.mockResolvedValue(1);
    model.askSmallModel.mockRejectedValue(new Error("gateway down"));
    await expect(guardPrivateData(input)).rejects.toThrow(/private mail/);
  });

  it("lets a message through that shares nothing private", async () => {
    db.sokoBotToolCall.count.mockResolvedValue(1);
    model.askSmallModel.mockResolvedValue({
      output: { sharesPrivate: false, what: "" },
      costUsd: 0,
    });
    await expect(guardPrivateData(input)).resolves.toBeUndefined();
  });
});

describe("describeReply", () => {
  it("gives the reply's status and its links", async () => {
    model.askSmallModel.mockResolvedValue({
      output: { status: "done" },
      costUsd: 0,
    });
    expect(
      await describeReply(
        "Done: see https://docs.example.com/table and https://docs.example.com/table.",
      ),
    ).toEqual({
      replyStatus: "done",
      links: ["https://docs.example.com/table"],
    });
  });

  it("still gives the links when the status cannot be read", async () => {
    model.askSmallModel.mockRejectedValue(new Error("down"));
    expect(
      await describeReply("Working on it, draft at https://x.test/a"),
    ).toEqual({
      replyStatus: null,
      links: ["https://x.test/a"],
    });
  });
});
