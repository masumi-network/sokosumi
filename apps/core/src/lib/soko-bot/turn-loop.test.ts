import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  buildActionResponseMock,
  claimsActionMock,
  turnUpdate,
  turnFind,
  toolCallFind,
  eventFindFirst,
  eventCreate,
} = vi.hoisted(() => ({
  buildActionResponseMock: vi.fn(),
  claimsActionMock: vi.fn(),
  turnUpdate: vi.fn(),
  turnFind: vi.fn(),
  toolCallFind: vi.fn(),
  eventFindFirst: vi.fn(),
  eventCreate: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { update: turnUpdate, findUnique: turnFind },
    sokoBotToolCall: { findMany: toolCallFind },
    sokoBotRuntimeEvent: { findFirst: eventFindFirst, create: eventCreate },
  },
}));
vi.mock("./answer-claims", () => ({ claimsAction: claimsActionMock }));
vi.mock("./action-response", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./action-response")>()),
  buildActionResponse: buildActionResponseMock,
}));

import {
  contextBlock,
  finishTurn,
  latestExchange,
  RuntimeEventLog,
  runtimeEvent,
} from "./turn-loop";

describe("RuntimeEventLog", () => {
  it("lands every event when a batch of parallel requests appends at once", async () => {
    const taken = new Set<number>();
    eventFindFirst.mockImplementation(async () =>
      taken.size ? { startIndex: Math.max(...taken) } : null,
    );
    eventCreate.mockImplementation(
      async ({ data }: { data: { startIndex: number } }) => {
        // Every request reads the tail before any of them writes.
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (taken.has(data.startIndex))
          throw Object.assign(new Error("Unique constraint"), {
            code: "P2002",
          });
        taken.add(data.startIndex);
      },
    );
    // Each tool call is its own request with its own log, as in production.
    await Promise.all(
      Array.from({ length: 13 }, () =>
        new RuntimeEventLog("turn-one", "session-one").append(
          runtimeEvent("actions.requested", { actions: [] }),
        ),
      ),
    );
    expect([...taken].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 13 }, (_, index) => index),
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

  it("stays out when the last turn was not chat or is a day old", () => {
    const exchange = (turns: unknown[]) =>
      latestExchange({ recentTurns: turns }, now);
    expect(exchange([{ ...offer, source: "EVENT" }])).toEqual([]);
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

function completedMessage(): unknown {
  return log.append.mock.calls
    .map(([event]) => event)
    .find((event) => event.type === "message.completed")?.data.message;
}

beforeEach(() => {
  vi.clearAllMocks();
  claimsActionMock.mockResolvedValue(false);
  toolCallFind.mockResolvedValue([]);
  buildActionResponseMock.mockImplementation(
    async (_tx, _turnId, text: string) => ({ answerText: text }),
  );
});

describe("finishTurn", () => {
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

  it("lets the message report the changes its receipts confirm", async () => {
    toolCallFind.mockResolvedValue([
      { capability: "update_memory" },
      { capability: "update_memory" },
    ]);
    await finish("Wrap: two tasks done. I updated memory.", true);
    expect(claimsActionMock).toHaveBeenCalledWith(
      "Wrap: two tasks done. I updated memory.",
      ["Updated memory"],
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
