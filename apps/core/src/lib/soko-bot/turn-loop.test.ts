import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  buildActionResponseMock,
  claimsActionMock,
  turnUpdate,
  turnFind,
  toolCallFind,
  eventTransaction,
} = vi.hoisted(() => ({
  buildActionResponseMock: vi.fn(),
  claimsActionMock: vi.fn(),
  turnUpdate: vi.fn(),
  turnFind: vi.fn(),
  toolCallFind: vi.fn(),
  eventTransaction: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { update: turnUpdate, findUnique: turnFind },
    sokoBotToolCall: { findMany: toolCallFind },
    $transaction: eventTransaction,
  },
}));
vi.mock("./answer-claims", () => ({ claimsAction: claimsActionMock }));
vi.mock("./action-response", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./action-response")>()),
  buildActionResponse: buildActionResponseMock,
}));

import { getSokoBotVersion } from "@sokosumi/soko-bot";
import { expectCoreLogWhys } from "@/test/core-log";
import { withPromptCache } from "./stream-model-call";
import {
  finishTurn,
  offeredCapabilities,
  promptCacheKey,
  RuntimeEventLog,
  runtimeEvent,
  sokoBotMaxSteps,
  sokoBotToolCallTimeoutMs,
  stableCapabilities,
  turnRequiresActionProof,
} from "./turn-loop";

describe("a version with one fixed tool set", () => {
  const v24 = getSokoBotVersion("cmo-v24");

  it("offers the same tools whatever the route granted", () => {
    const narrow = stableCapabilities(v24, ["read_calendar"]);
    expect(stableCapabilities(v24, ["create_task", "read_calendar"])).toEqual(
      narrow,
    );
    expect(narrow).toContain("save_strategy");
    expect(narrow).toContain("read_skill");
    expect(narrow).not.toContain("search_exa");
    expect(stableCapabilities(v24, ["search_exa"])).toContain("search_exa");
  });

  it("decides the answer format from the offered tools, start and finish alike", () => {
    const readOnly = {
      grant: { capabilities: ["read_calendar"] },
      turn: { source: "SCHEDULE", chainDepth: 0 },
    } as never;
    const offered = offeredCapabilities(v24, readOnly, { sandbox: true });
    expect(offered).toContain("create_social_post");
    expect(turnRequiresActionProof(offered)).toBe(true);
    // Before the fixed tool set, the grant alone decided.
    expect(turnRequiresActionProof(["read_calendar"])).toBe(false);
  });

  it("offers the sandbox's own tools only when the route grants them", () => {
    const v36 = { ...getSokoBotVersion("v36"), skillsOnDemand: true as const };
    const scheduled = stableCapabilities(v36, ["create_task"]);
    expect(scheduled).not.toContain("bash");
    expect(scheduled).not.toContain("web_fetch");
    expect(scheduled).toContain("create_task");
    expect(scheduled).toContain("hire_agent");
    const asked = stableCapabilities(v36, ["bash", "web_fetch"]);
    expect(asked).toContain("bash");
    expect(asked).toContain("web_fetch");
  });

  it("keys the cache by system prompt and tools, not by turn", () => {
    const key = promptCacheKey("cmo-v24", "system", ["a", "b"], []);
    expect(promptCacheKey("cmo-v24", "system", ["a", "b"], [])).toBe(key);
    expect(promptCacheKey("cmo-v24", "system", ["a"], [])).not.toBe(key);
    expect(
      promptCacheKey("cmo-v24", "system", ["a", "b"], ["save_strategy"]),
    ).not.toBe(key);
    expect(key).toMatch(/^cmo-v24:[0-9a-f]{16}$/);
  });

  it("asks OpenAI to keep the prefix as long as the model allows", () => {
    expect(
      withPromptCache(
        { openai: { reasoningSummary: "auto" } },
        "cmo-v24:k",
        "openai/gpt-6-luna",
      ),
    ).toEqual({
      openai: {
        reasoningSummary: "auto",
        promptCacheKey: "cmo-v24:k",
        promptCacheOptions: { ttl: "12h" },
      },
    });
    expect(
      withPromptCache<Record<string, unknown>>({}, "v36:k", "openai/gpt-5.4")
        .openai,
    ).toMatchObject({ promptCacheRetention: "24h" });
    const plain = { openai: { reasoningSummary: "auto" } };
    expect(withPromptCache(plain, null, "openai/gpt-6-luna")).toBe(plain);
  });
});

describe("sokoBotToolCallTimeoutMs", () => {
  it("gives the month writer its time, inside the sandbox runner's two minutes", () => {
    expect(sokoBotToolCallTimeoutMs("write_month_pieces")).toBe(115_000);
    expect(sokoBotToolCallTimeoutMs("write_month_pieces")).toBeLessThan(
      120_000,
    );
    expect(sokoBotToolCallTimeoutMs("save_strategy")).toBe(90_000);
  });
});

describe("RuntimeEventLog", () => {
  it("gives a large batch of parallel requests one slot each, under the turn's lock", async () => {
    const taken = new Set<number>();
    const locks = new Map<string, Promise<void>>();
    // A transaction-scoped advisory lock: held from the SELECT to the end.
    eventTransaction.mockImplementation(
      async (operation: (tx: unknown) => Promise<unknown>) => {
        let release = () => {};
        const tx = {
          $queryRaw: async () => [{ now: new Date() }],
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
    const warnings = expectCoreLogWhys("warn", "Withheld a Soko Bot reply", [
      "The reply claims a change that no action receipt confirms",
    ]);
    claimsActionMock.mockResolvedValue(true);
    await finish("I created the task and assigned it to Hannah.", true);
    expect(buildActionResponseMock.mock.calls[0][4]).toMatchObject({
      message: null,
    });
    // Counted, never quoted.
    expect(warnings[0]?.event).toMatchObject({
      replyWithheld: { reason: "claims_unconfirmed_change" },
    });
    expect(JSON.stringify(warnings[0]?.event)).not.toContain("Hannah");
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

  it("includes completed CMO saves in confirmedChanges and ignores unwritten strategy/month results", async () => {
    toolCallFind.mockResolvedValue([
      { capability: "save_brand_brain", result: { saved: "brandBrain" } },
      { capability: "save_strategy", result: { saved: "strategy" } },
      {
        capability: "write_strategy",
        result: { written: true, versionId: "v2" },
      },
      { capability: "write_month_pieces", result: { written: 4, left: 0 } },
    ]);
    await finish(
      "I updated your Brand Brain, strategy, and month pieces.",
      true,
    );
    expect(toolCallFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              capability: {
                in: expect.arrayContaining([
                  "save_seo_suggestions",
                  "save_brand_brain",
                  "save_strategy",
                  "write_strategy",
                  "write_month_pieces",
                ]),
              },
            },
          ]),
        }),
      }),
    );
    expect(claimsActionMock).toHaveBeenCalledWith(
      "I updated your Brand Brain, strategy, and month pieces.",
      ["Saved Brand Brain", "Saved marketing strategy", "Wrote month pieces"],
    );

    claimsActionMock.mockClear();
    toolCallFind.mockResolvedValue([
      {
        capability: "write_strategy",
        result: { written: false, reason: "err" },
      },
      { capability: "write_strategy", result: { writing: true } },
      { capability: "write_month_pieces", result: { written: 0, left: 0 } },
    ]);
    await finish("Still working on your strategy.", true);
    expect(claimsActionMock).toHaveBeenCalledWith(
      "Still working on your strategy.",
      [],
    );
  });

  it("says so when the message could not be checked", async () => {
    expectCoreLogWhys("warn", "Withheld a Soko Bot reply", [
      "The check for claims of unconfirmed changes could not run",
    ]);
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
