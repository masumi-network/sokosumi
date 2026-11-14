import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  buildActionResponseMock,
  claimsActionMock,
  turnUpdate,
  turnFind,
  toolCallFind,
  eventTransaction,
  executeToolMock,
} = vi.hoisted(() => ({
  buildActionResponseMock: vi.fn(),
  claimsActionMock: vi.fn(),
  turnUpdate: vi.fn(),
  turnFind: vi.fn(),
  toolCallFind: vi.fn(),
  eventTransaction: vi.fn(),
  executeToolMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { update: turnUpdate, findUnique: turnFind },
    sokoBotToolCall: { findMany: toolCallFind },
    $transaction: eventTransaction,
  },
}));
vi.mock("./answer-claims", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./answer-claims")>()),
  claimsAction: claimsActionMock,
}));
vi.mock("@/services/soko-bot-runtime.service", () => ({
  sokoBotRuntimeService: { executeTool: executeToolMock },
}));
vi.mock("./action-response", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./action-response")>()),
  buildActionResponse: buildActionResponseMock,
}));

import {
  contextBlock,
  finishTurn,
  latestExchange,
  RuntimeEventLog,
  runTurnTool,
  runtimeEvent,
  sokoBotMaxSteps,
} from "./turn-loop";

describe("RuntimeEventLog", () => {
  it("gives a large batch of parallel requests one slot each, under the turn's lock", async () => {
    const taken = new Set<number>();
    const locks = new Map<string, Promise<void>>();
    // A transaction-scoped advisory lock: held from the SELECT to the end.
    eventTransaction.mockImplementation(
      async (operation: (tx: unknown) => Promise<unknown>) => {
        let release = () => {};
        const tx = {
          $executeRaw: async (_sql: TemplateStringsArray, key: string) => {
            const previous = locks.get(key) ?? Promise.resolve();
            const held = new Promise<void>((resolve) => {
              release = resolve;
            });
            locks.set(
              key,
              previous.then(() => held),
            );
            await previous;
          },
          sokoBotRuntimeEvent: {
            findFirst: async () =>
              taken.size ? { startIndex: Math.max(...taken) } : null,
            create: async ({ data }: { data: { startIndex: number } }) => {
              // Without the lock every request would read the same tail.
              await new Promise((resolve) => setTimeout(resolve, 1));
              if (taken.has(data.startIndex))
                throw Object.assign(new Error("Unique constraint"), {
                  code: "P2002",
                });
              taken.add(data.startIndex);
            },
          },
        };
        try {
          return await operation(tx);
        } finally {
          release();
        }
      },
    );
    // Each tool call is its own request with its own log, as in production.
    await Promise.all(
      Array.from({ length: 40 }, () =>
        new RuntimeEventLog("turn-one", "session-one").append(
          runtimeEvent("actions.requested", { actions: [] }),
        ),
      ),
    );
    expect([...taken].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 40 }, (_, index) => index),
    );
  });
});

describe("contextBlock", () => {
  it("states the reply language last, after the packet and the latest exchange", () => {
    const now = Date.parse("2026-09-30T21:27:00Z");
    const lines = contextBlock(
      {
        recentTurns: [
          {
            source: "CHAT",
            userMessage: "Erinnere mich jeden Montag.",
            finalAnswer: "Soll ich das so einrichten?",
            completedAt: "2026-09-30T21:26:00Z",
          },
        ],
      },
      '{"memory":"Standup auf Deutsch"}',
      now,
    );
    const language = lines.findIndex((line) =>
      line.startsWith("Reply in the language of the owner's latest message"),
    );
    expect(language).toBe(lines.length - 1);
    expect(lines.findIndex((line) => line.startsWith("You: Soll ich"))).toBe(
      language - 2,
    );
  });
});

describe("latestExchange", () => {
  const now = Date.parse("2026-09-30T18:05:14Z");
  const offer = {
    source: "CHAT",
    userMessage: "Swap Gravity for a better one and update the file.",
    finalAnswer: `${"Research table… ".repeat(60)}Want me to replace the Gravity row in competitors-r5.md?`,
    completedAt: "2026-09-30T18:03:40Z",
  };

  it("repeats the bot's own offer in full, so a bare yes can answer it", () => {
    const block = latestExchange({ recentTurns: [offer] }, now).join("\n");
    expect(block).toContain("LATEST EXCHANGE");
    expect(block).toContain(
      "Want me to replace the Gravity row in competitors-r5.md?",
    );
    expect(block).toContain(`Owner: ${offer.userMessage}`);
  });

  it("repeats a post the bot made on its own, without Core's prompt", () => {
    const block = latestExchange(
      {
        recentTurns: [
          {
            ...offer,
            source: "INGEST",
            userMessage: "New mail arrived that looks important…",
            finalAnswer:
              "DigitalOcean — masumi-payment-dev: deployment failed.",
          },
        ],
      },
      now,
    ).join("\n");
    expect(block).toContain(
      "You, posted on your own (ingest): DigitalOcean — masumi-payment-dev: deployment failed.",
    );
    expect(block).not.toContain("Owner:");
  });

  it("repeats every post the bot made on its own since the owner last wrote", () => {
    const post = (source: string, finalAnswer: string) => ({
      ...offer,
      source,
      finalAnswer,
    });
    const block = latestExchange(
      {
        recentTurns: [
          offer,
          post("INGEST", "Make — s_New_Registration: two recent errors."),
          post("INGEST", "DigitalOcean — masumi-payment-dev: deploy failed."),
          post("SCHEDULE", "End of day: one Task completed."),
        ],
      },
      now,
    ).join("\n");
    expect(block).not.toContain("Owner:");
    expect(block).not.toContain("Want me to replace");
    for (const line of [
      "You, posted on your own (ingest): Make — s_New_Registration: two recent errors.",
      "You, posted on your own (ingest): DigitalOcean — masumi-payment-dev: deploy failed.",
      "You, posted on your own (schedule): End of day: one Task completed.",
    ])
      expect(block).toContain(line);
  });

  it("stays out when the last turn is a day old or missing", () => {
    const exchange = (turns: unknown[]) =>
      latestExchange({ recentTurns: turns }, now);
    expect(
      exchange([{ ...offer, completedAt: "2026-09-28T18:00:00Z" }]),
    ).toEqual([]);
    expect(exchange([])).toEqual([]);
    expect(latestExchange({ memory: {} }, now)).toEqual([]);
  });
});

const log = { append: vi.fn(), turnId: "turn-1" };

function finish(text: string, requiresActionProof: boolean) {
  return finishTurn({
    log: log as never,
    turnId: "turn-1",
    text,
    finishReason: "stop",
    requiresActionProof,
  });
}

function savedRecallTurn() {
  return {
    source: "CHAT",
    route: "DIRECT_RESPONSE",
    userMessage: "What did I tell you about Tasks for Hannah?",
    contextSnapshot: {
      packet: {
        trigger: {
          source: "CHAT",
          route: "DIRECT_RESPONSE",
          askedBy: { kind: "OWNER" },
        },
        memory: {
          markdown:
            "# Soko Bot memory\n\n## Preferences\n- Write every Task for Hannah in German.",
        },
      },
    },
  };
}

function savedBoardTurn() {
  return {
    ...savedRecallTurn(),
    userMessage:
      "Which of my open tasks have not moved for more than a week, and who has each one?",
    toolCalls: [
      {
        capability: "list_tasks",
        status: "COMPLETED",
        input: { state: "open", limit: 25 },
        createdAt: new Date("2026-11-14T13:11:31Z"),
        result: {
          tasks: [
            {
              id: "01a1da2c-f827-7122-9a10-25897248360f",
              name: "Launch QA",
              owner: "your owner",
              status: "DRAFT",
              updatedAt: "2026-11-14T13:09:02.631Z",
              assignee: { kind: "member", name: "Robin Keller" },
            },
          ],
          total: 1,
        },
      },
    ],
  };
}

function completedMessage(): unknown {
  return log.append.mock.calls
    .map(([event]) => event)
    .find((event) => event.type === "message.completed")?.data.message;
}

beforeEach(() => {
  vi.clearAllMocks();
  claimsActionMock.mockResolvedValue(false);
  toolCallFind.mockResolvedValue([]);
  turnFind.mockResolvedValue(null);
  buildActionResponseMock.mockImplementation(
    async (_tx, _turnId, text: string) => ({ answerText: text }),
  );
});

describe("runTurnTool table creation", () => {
  it("tells the model to retry an empty directory search", async () => {
    executeToolMock.mockResolvedValue({ people: [], coworkers: [] });
    await expect(
      runTurnTool({
        log: log as never,
        capability: "find_coworkers",
        toolCallId: "directory-1",
        toolInput: { query: "research" },
      }),
    ).resolves.toMatchObject({
      evidenceToolCallId: "directory-1",
      result: {
        people: [],
        coworkers: [],
        instruction: expect.stringContaining("Retry without a query"),
      },
    });
  });

  it("does not invite a preview after a confirmed schedule deletion", async () => {
    executeToolMock.mockResolvedValue({
      id: "deleted-1",
      name: "Old check",
      deleted: true,
    });
    await expect(
      runTurnTool({
        log: log as never,
        capability: "delete_schedule",
        toolCallId: "delete-1",
        toolInput: { scheduleId: "deleted-1" },
      }),
    ).resolves.toMatchObject({
      id: "deleted-1",
      instruction: expect.stringContaining("do not call preview_result"),
    });
  });

  it("tells the model that successful creation already inserted its rows", async () => {
    executeToolMock.mockResolvedValue({
      table: { id: "table-1", title: "Launch research" },
      url: "/drive/tables/table-1",
    });
    const result = await runTurnTool({
      log: log as never,
      capability: "create_table",
      toolCallId: "create-1",
      toolInput: { rows: [{ name: "A" }, { name: "B" }] },
    });
    expect(result).toMatchObject({
      table: { id: "table-1", title: "Launch research" },
      initialRowCount: 2,
      instruction: expect.stringContaining("Do not insert those rows again"),
    });
  });
});

describe("finishTurn", () => {
  it("shows the message, not the JSON, when a plain turn replies in JSON", async () => {
    await finish(
      '{"kind":"REPORT","message":"Team trials now lead.","question":null,"observationToolCallIds":[]}',
      false,
    );
    expect(buildActionResponseMock.mock.calls[0][2]).toBe(
      "Team trials now lead.",
    );
  });

  it("keeps plain prose as the bot's message on a turn that could act", async () => {
    await finish("Here is the draft for your review.", true);
    expect(buildActionResponseMock.mock.calls[0][4]).toMatchObject({
      kind: "REPORT",
      message: "Here is the draft for your review.",
    });
  });

  it("drops a message that claims an action no receipt proves", async () => {
    claimsActionMock.mockResolvedValue(true);
    await finish("I created the task and assigned it to Hannah.", true);
    expect(buildActionResponseMock.mock.calls[0][4]).toMatchObject({
      message: null,
    });
  });

  it("answers a suppressed owner recall from matching saved memory, not the model's claim", async () => {
    const { buildActionResponse } =
      await vi.importActual<typeof import("./action-response")>(
        "./action-response",
      );
    buildActionResponseMock.mockImplementationOnce(buildActionResponse);
    claimsActionMock.mockResolvedValue(true);
    turnFind.mockResolvedValue(savedRecallTurn());
    await finish("I created a German Task for Hannah.", true);
    const narrative = buildActionResponseMock.mock.calls[0][4];
    expect(narrative.message).toBe(
      "Saved memory:\n> Write every Task for Hannah in German.",
    );
    expect(narrative.message).not.toContain("I created");
    expect(completedMessage()).toBe(narrative.message);
    expect(turnUpdate.mock.calls[0][0].data.responseContract.answerText).toBe(
      narrative.message,
    );
  });

  it("does not replace a mutation report with a memory quotation", async () => {
    claimsActionMock.mockResolvedValue(true);
    toolCallFind.mockResolvedValue([{ capability: "update_memory" }]);
    turnFind.mockResolvedValue(savedRecallTurn());
    await finish("I sent Hannah a new Task.", true);
    expect(buildActionResponseMock.mock.calls[0][4].message).toBeNull();
  });

  it("answers a withheld idle-board question from the complete same-turn read", async () => {
    const { buildActionResponse } =
      await vi.importActual<typeof import("./action-response")>(
        "./action-response",
      );
    buildActionResponseMock.mockImplementationOnce(buildActionResponse);
    claimsActionMock.mockResolvedValue(true);
    const board = savedBoardTurn();
    turnFind.mockResolvedValue(board);
    toolCallFind.mockImplementation(async ({ where }) =>
      where.capability?.in?.includes("list_tasks")
        ? board.toolCalls.map(({ capability, result }) => ({
            capability,
            result,
          }))
        : [],
    );
    await finish("I moved all those Tasks forward.", true);
    const narrative = buildActionResponseMock.mock.calls[0][4];
    expect(narrative.message).toBe(
      "None of your open Tasks has been idle for more than 1 week.",
    );
    expect(narrative.message).not.toContain("I moved");
    expect(completedMessage()).toBe(narrative.message);
    expect(claimsActionMock.mock.calls[0][2]).toEqual([
      { capability: "list_tasks", result: board.toolCalls[0].result },
    ]);
    expect(turnFind).toHaveBeenCalledWith({
      where: { id: "turn-1" },
      select: expect.objectContaining({
        toolCalls: expect.objectContaining({
          where: { capability: "list_tasks", status: "COMPLETED" },
          take: 1,
        }),
      }),
    });
  });

  it("keeps the failed-check warning even when matching memory exists", async () => {
    claimsActionMock.mockResolvedValue(null);
    turnFind.mockResolvedValue(savedRecallTurn());
    await finish("Hannah's Tasks are in German.", true);
    const message = buildActionResponseMock.mock.calls[0][4].message;
    expect(message).toContain("could not be checked");
    expect(message).not.toContain("German");
  });

  it("lets the message report the changes its receipts confirm", async () => {
    toolCallFind.mockResolvedValue([
      { capability: "update_memory" },
      { capability: "update_memory" },
    ]);
    await finish("Wrap: two tasks done. I updated memory.", true);
    expect(claimsActionMock).toHaveBeenCalledWith(
      "Wrap: two tasks done. I updated memory.",
      ["Updated memory"],
      [],
    );
  });

  it("gives the claim check chat observations without treating reads as changes", async () => {
    const result = {
      messages: [{ author: "Hannah", content: "Research is ready." }],
    };
    toolCallFind.mockResolvedValue([
      { capability: "read_chat", result },
      { capability: "update_memory", result: {} },
    ]);
    await finish("Hannah says the research is ready.", true);
    expect(claimsActionMock).toHaveBeenCalledWith(
      "Hannah says the research is ready.",
      ["Updated memory"],
      [{ capability: "read_chat", result }],
    );
    expect(toolCallFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          turnId: "turn-1",
          status: "COMPLETED",
        }),
      }),
    );
    expect(toolCallFind).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 4,
        select: { capability: true, result: true },
        where: expect.objectContaining({
          turnId: "turn-1",
          status: "COMPLETED",
          capability: { in: expect.arrayContaining(["read_chat"]) },
        }),
      }),
    );
  });

  it("says so when the message could not be checked", async () => {
    claimsActionMock.mockResolvedValue(null);
    await finish("Here is what I found.", true);
    expect(buildActionResponseMock.mock.calls[0][4].message).toContain(
      "could not be checked",
    );
  });

  it("checks the stored message too, which settlement shows again", async () => {
    turnFind.mockResolvedValue({
      userMessage: "",
      contextSnapshot: { packet: null },
      toolCalls: [],
    });
    buildActionResponseMock.mockImplementation(
      async (_tx, _turnId, text: string, _requested, narrative) => ({
        answerText: text,
        narrative,
      }),
    );
    await finish("Book at evil-login.com/account now.", true);
    const stored = turnUpdate.mock.calls[0][0].data.responseContract;
    expect(stored.narrative.message).not.toContain("evil-login.com");
    expect(stored.answerText).not.toContain("evil-login.com");
  });

  it("keeps links to pages the turn loaded and drops the rest", async () => {
    turnFind.mockResolvedValue({
      userMessage: "When is TOKEN2049?",
      contextSnapshot: { packet: null },
      toolCalls: [
        {
          capability: "web_fetch",
          result: { sources: ["https://www.token2049.com/singapore"] },
        },
        // A fetch that failed gives no grounds, though its address is here.
        {
          capability: "web_fetch",
          result: { output: "https://blocked.example/page", sources: [] },
        },
      ],
    });
    await finish(
      "7–8 October ([site](https://www.token2049.com/singapore)), see also https://blocked.example/page",
      false,
    );
    const message = completedMessage();
    expect(message).toContain("([site](https://www.token2049.com/singapore))");
    expect(message).not.toContain("blocked.example");
    expect(message).toContain("I removed a link");
    expect(turnUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          responseContract: expect.objectContaining({ answerText: message }),
        },
      }),
    );
  });

  it("reads nothing more when the answer has no links", async () => {
    await finish("Nothing to add.", false);
    expect(turnFind).not.toHaveBeenCalled();
    expect(completedMessage()).toBe("Nothing to add.");
  });
});

describe("sokoBotMaxSteps", () => {
  it("keeps 40 for a quarter hour and scales longer turns", () => {
    expect(sokoBotMaxSteps(15 * 60 * 1_000)).toBe(40);
    expect(sokoBotMaxSteps(60 * 60 * 1_000)).toBe(160);
    expect(sokoBotMaxSteps(60_000)).toBe(40);
  });
});
