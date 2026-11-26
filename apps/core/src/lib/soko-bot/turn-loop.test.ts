import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  buildActionResponseMock,
  claimsActionMock,
  turnUpdate,
  turnFind,
  toolCallFind,
  runtimeEventFind,
  eventTransaction,
} = vi.hoisted(() => ({
  buildActionResponseMock: vi.fn(),
  claimsActionMock: vi.fn(),
  turnUpdate: vi.fn(),
  turnFind: vi.fn(),
  toolCallFind: vi.fn(),
  runtimeEventFind: vi.fn(),
  eventTransaction: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { update: turnUpdate, findUnique: turnFind },
    sokoBotToolCall: { findMany: toolCallFind },
    sokoBotRuntimeEvent: { findFirst: runtimeEventFind },
    $transaction: eventTransaction,
  },
}));
vi.mock("./answer-claims", () => ({ claimsAction: claimsActionMock }));
vi.mock("./action-response", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./action-response")>()),
  buildActionResponse: buildActionResponseMock,
}));

import {
  getSokoBotVersion,
  SOKO_BOT_WEB_TAINTED_OUTWARD_CAPABILITIES,
} from "@sokosumi/soko-bot";
import { expectCoreLogWhys } from "@/test/core-log";
import { withPromptCache } from "./stream-model-call";
import {
  finishTurn,
  isOwnerDirected,
  isTaintBlocked,
  offeredCapabilities,
  promptCacheKey,
  RuntimeEventLog,
  runtimeEvent,
  SANDBOX_GUIDANCE,
  sokoBotMaxSteps,
  sokoBotToolCallTimeoutMs,
  stableCapabilities,
  turnRequiresActionProof,
  WEB_GUIDANCE,
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

describe("isOwnerDirected and isTaintBlocked", () => {
  const ownerChat = {
    source: "CHAT",
    parentTurnId: null as string | null,
    askedByUserId: null as string | null,
    requestedByUserId: "owner-1",
    chainDepth: 0,
    parentTurn: null as Record<string, unknown> | null,
  };

  it("treats direct owner CHAT turns (including chatMentionId: null) as owner-directed", async () => {
    turnFind.mockResolvedValue(ownerChat);
    expect(await isOwnerDirected("turn-direct")).toBe(true);

    turnFind.mockResolvedValue({ ...ownerChat, askedByUserId: "owner-1" });
    expect(await isOwnerDirected("turn-shared-member")).toBe(true);

    turnFind.mockResolvedValue({ ...ownerChat, askedByUserId: "teammate-2" });
    expect(await isOwnerDirected("turn-teammate")).toBe(false);

    turnFind.mockResolvedValue({ ...ownerChat, chainDepth: 1 });
    expect(await isOwnerDirected("turn-chained")).toBe(false);
  });

  it("requires an owner CHAT root for background children and rejects INGEST or EVENT children", async () => {
    // Background run started from owner CHAT
    turnFind.mockResolvedValue({
      ...ownerChat,
      parentTurnId: "root-chat",
      parentTurn: { ...ownerChat },
    });
    expect(await isOwnerDirected("child-of-chat")).toBe(true);

    // Grandchild whose root is owner CHAT
    turnFind
      .mockResolvedValueOnce({
        ...ownerChat,
        parentTurnId: "child-1",
        parentTurn: { ...ownerChat, parentTurnId: "root-chat" },
      })
      .mockResolvedValueOnce({ ...ownerChat, parentTurnId: null });
    expect(await isOwnerDirected("grandchild-of-chat")).toBe(true);

    // Background run started from non-owner INGEST (must stay blocked)
    turnFind.mockResolvedValue({
      ...ownerChat,
      source: "INGEST",
      parentTurnId: "root-ingest",
      parentTurn: { ...ownerChat, source: "INGEST" },
    });
    expect(await isOwnerDirected("child-of-ingest")).toBe(false);

    // Even if a child claims source CHAT, an INGEST parent fails closed
    turnFind.mockResolvedValue({
      ...ownerChat,
      parentTurnId: "root-ingest",
      parentTurn: { ...ownerChat, source: "INGEST" },
    });
    expect(await isOwnerDirected("chat-child-of-ingest")).toBe(false);

    // Grandchild whose root is INGEST fails closed
    turnFind
      .mockResolvedValueOnce({
        ...ownerChat,
        parentTurnId: "child-1",
        parentTurn: { ...ownerChat, parentTurnId: "root-ingest" },
      })
      .mockResolvedValueOnce({
        ...ownerChat,
        source: "INGEST",
        parentTurnId: null,
      });
    expect(await isOwnerDirected("grandchild-of-ingest")).toBe(false);

    // Autonomous EVENT child hung under an owner CHAT (e.g. CMO production)
    turnFind.mockResolvedValue({
      ...ownerChat,
      source: "EVENT",
      parentTurnId: "root-chat",
      parentTurn: { ...ownerChat },
    });
    expect(await isOwnerDirected("event-child-of-chat")).toBe(false);

    // Cycle or missing parent fails closed
    turnFind.mockResolvedValue({
      ...ownerChat,
      parentTurnId: "self-cycle",
      parentTurn: { ...ownerChat, parentTurnId: "self-cycle" },
    });
    expect(await isOwnerDirected("self-cycle")).toBe(false);
  });

  it("allows owner-directed tainted drafts and newsletters while keeping outward social actions and INGEST children blocked", async () => {
    runtimeEventFind.mockResolvedValue({ id: "taint-1" });
    turnFind.mockResolvedValue(ownerChat);

    for (const allowed of [
      "create_newsletter_issue",
      "newsletter_draft_issue",
      "create_social_post",
      "update_social_post",
      "update_social_posts",
      "upload_file",
      "hire_agent",
    ] as const) {
      expect(await isTaintBlocked("turn-direct", allowed)).toBe(false);
    }

    for (const blocked of [
      "schedule_social_post",
      "cancel_social_post",
      "publish_social_post",
      "post_chat",
      "run_integration_tool",
      "add_newsletter_subscriber",
    ] as const) {
      expect(await isTaintBlocked("turn-direct", blocked)).toBe(true);
    }

    // Delegated EVENT turns (even under an owner CHAT parent) must stay
    // blocked on social edits, and both social edit tools stay in
    // SOKO_BOT_WEB_TAINTED_OUTWARD_CAPABILITIES so delegated follow-up grants
    // never inherit them (while create_social_post remains inheritable).
    expect(SOKO_BOT_WEB_TAINTED_OUTWARD_CAPABILITIES).toContain(
      "update_social_post",
    );
    expect(SOKO_BOT_WEB_TAINTED_OUTWARD_CAPABILITIES).toContain(
      "update_social_posts",
    );
    expect(
      SOKO_BOT_WEB_TAINTED_OUTWARD_CAPABILITIES as readonly string[],
    ).not.toContain("create_social_post");

    turnFind.mockResolvedValue({
      ...ownerChat,
      source: "EVENT",
      parentTurnId: "root-chat",
      parentTurn: { ...ownerChat },
    });
    for (const blocked of [
      "update_social_post",
      "update_social_posts",
    ] as const) {
      expect(await isTaintBlocked("event-child-of-chat", blocked)).toBe(true);
    }

    // Background child of an INGEST turn must remain blocked on every tainted write
    turnFind.mockResolvedValue({
      ...ownerChat,
      parentTurnId: "root-ingest",
      parentTurn: { ...ownerChat, source: "INGEST" },
    });
    for (const blocked of [
      "send_email_draft",
      "hire_agent",
      "install_skill",
      "create_newsletter_issue",
      "create_social_post",
      "update_social_post",
      "update_social_posts",
    ] as const) {
      expect(await isTaintBlocked("child-of-ingest", blocked)).toBe(true);
    }
  });

  it("keeps WEB_GUIDANCE aligned with SANDBOX_GUIDANCE on the owner-directed exception", () => {
    for (const guidance of [SANDBOX_GUIDANCE, WEB_GUIDANCE]) {
      expect(guidance).toContain(
        "On work your owner asked for in their chat (and background runs they started)",
      );
      expect(guidance).toContain("drafting newsletters");
      expect(guidance).toContain(
        "creating or editing unapproved social post drafts still work",
      );
      expect(guidance).toContain("editing scheduled social posts are refused");
    }
  });
});
