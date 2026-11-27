import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  buildActionResponseMock,
  claimsActionMock,
  claimsActionBySentenceMock,
  turnUpdate,
  turnFind,
  toolCallFind,
  runtimeEventFind,
  eventTransaction,
  strategyFind,
} = vi.hoisted(() => ({
  strategyFind: vi.fn(),
  buildActionResponseMock: vi.fn(),
  claimsActionMock: vi.fn(),
  claimsActionBySentenceMock: vi.fn(),
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
    marketingStrategy: { findMany: strategyFind },
    $transaction: eventTransaction,
  },
}));
vi.mock("./answer-claims", () => ({
  claimsAction: claimsActionMock,
  claimsActionBySentence: (...args: unknown[]) =>
    claimsActionBySentenceMock(...args),
}));
vi.mock("./action-response", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./action-response")>()),
  buildActionResponse: buildActionResponseMock,
}));

import {
  applyVersionCapabilities,
  CMO_PRODUCTION_TOOLS,
  getSokoBotVersion,
  SOKO_BOT_CAPABILITIES,
  SOKO_BOT_WEB_TAINTED_OUTWARD_CAPABILITIES,
} from "@sokosumi/soko-bot";
import { expectCoreLogWhys } from "@/test/core-log";
import { withPromptCache } from "./stream-model-call";
import {
  finishTurn,
  isOwnerDirected,
  isTaintBlocked,
  offeredCapabilities,
  PENDING_STRATEGY_LABEL,
  productionPacket,
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

describe("a small-context production run (cmo-v26)", () => {
  it("offers only tools the version has", () => {
    const v26 = applyVersionCapabilities(
      getSokoBotVersion("cmo-v26"),
      SOKO_BOT_CAPABILITIES,
    );
    for (const tool of CMO_PRODUCTION_TOOLS) expect(v26).toContain(tool);
  });

  it("keeps the marketing context, the owner's memory and who started it, and leaves the rest out", () => {
    const packet = {
      schemaVersion: 1,
      generatedAt: "2026-11-26T00:00:00Z",
      trigger: { kind: "event" },
      actor: { name: "Robin" },
      projects: [],
      memory: "Never mention competitors by name.",
      recentTurns: [{ finalAnswer: "x".repeat(5000) }],
      sourceCoverage: { mail: "none" },
      tasks: [],
      workspace: { marketing: { core: { business: "Acme" } }, other: 1 },
    };
    expect(productionPacket(packet)).toEqual({
      schemaVersion: 1,
      generatedAt: "2026-11-26T00:00:00Z",
      trigger: { kind: "event" },
      actor: { name: "Robin" },
      projects: [],
      memory: "Never mention competitors by name.",
      workspace: { marketing: { core: { business: "Acme" } } },
    });
  });

  it("offers every tool cmo-v26's skills and packet send a production run to", () => {
    const v26 = getSokoBotVersion("cmo-v26");
    for (const tool of [
      "read_file",
      "list_files",
      "read_report",
      "read_memory",
      "research_competitor_keywords",
      "get_video",
      "list_newsletter_issues",
      "update_newsletter_issue",
      "update_social_posts",
    ])
      expect(CMO_PRODUCTION_TOOLS as readonly string[]).toContain(tool);
    const granted = offeredCapabilities(
      v26,
      {
        grant: { capabilities: [...CMO_PRODUCTION_TOOLS] },
        turn: { source: "EVENT", chainDepth: 0 },
      } as never,
      { sandbox: false, production: true },
    );
    expect(granted).toEqual([...CMO_PRODUCTION_TOOLS]);
  });
});

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

  it("offers update_plan without a sandbox only where Core keeps the plan", () => {
    const owner = {
      grant: { capabilities: ["update_plan", "bash", "create_task"] },
      turn: { source: "CHAT", chainDepth: 0 },
    } as never;
    const v37 = getSokoBotVersion("v37");
    expect(
      offeredCapabilities(v37, owner, { sandbox: false, web: true }),
    ).toEqual(["create_task"]);
    expect(
      offeredCapabilities({ ...v37, planLoop: true }, owner, {
        sandbox: false,
        web: true,
      }),
    ).toEqual(["update_plan", "create_task"]);
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
  claimsActionMock.mockReset();
  claimsActionBySentenceMock.mockReset();
  claimsActionMock.mockResolvedValue(false);
  toolCallFind.mockResolvedValue([]);
  strategyFind.mockResolvedValue([]);
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

  it("drops a message that is nothing but a claim no receipt proves", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
      ["The reply claims a change that no action receipt confirms"],
    );
    claimsActionMock.mockResolvedValue(true);
    await finish("I created the task and assigned it to Hannah.", true);
    expect(buildActionResponseMock.mock.calls[0][4]).toMatchObject({
      message: null,
    });
    // Counted, never quoted.
    expect(warnings[0]?.event).toMatchObject({
      replyChecked: { reason: "claims_unconfirmed_change" },
    });
    expect(JSON.stringify(warnings[0]?.event)).not.toContain("Hannah");
  });

  it("keeps the rest of a reply when only one sentence claims a change", async () => {
    expectCoreLogWhys(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
      ["The reply claims a change that no action receipt confirms"],
    );
    claimsActionMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await finish(
      "Your Padierfind project has an X account. I created the schedule. Approve the draft when you are ready?",
      true,
    );
    const narrative = buildActionResponseMock.mock.calls[0][4];
    expect(narrative.message).toBe(
      "Your Padierfind project has an X account. Approve the draft when you are ready?",
    );
    // The note is Core's, rendered beside the message, not inside it.
    expect(narrative.replyCheck).toBe("cut");
    expect(claimsActionMock).toHaveBeenLastCalledWith(
      "Your Padierfind project has an X account. Approve the draft when you are ready?",
      [],
    );
  });

  it("keeps a blocker that negates a list of changes", async () => {
    expectCoreLogWhys(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
      ["The reply claims a change that no action receipt confirms"],
    );
    claimsActionMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await finish(
      "I created the schedule. The post has not been drafted, scheduled, or published because the X account needs your approval. Nothing was posted — I drafted it.",
      true,
    );
    expect(buildActionResponseMock.mock.calls[0][4].message).toBe(
      "The post has not been drafted, scheduled, or published because the X account needs your approval.",
    );
  });

  it("cuts only the bot's own claims and keeps what others did", async () => {
    expectCoreLogWhys(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
      ["The reply claims a change that no action receipt confirms"],
    );
    claimsActionMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await finish(
      [
        "Hannah sent the recording on Monday.",
        "The reviewer added two comments to the Task.",
        "I created the weekly schedule.",
        "The draft was saved to your Project.",
        "Drafted three options for you.",
      ].join(" "),
      true,
    );
    expect(buildActionResponseMock.mock.calls[0][4].message).toBe(
      "Hannah sent the recording on Monday. The reviewer added two comments to the Task.",
    );
  });

  it("does not read a comma between two verbs as one negated list", async () => {
    expectCoreLogWhys(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
      ["The reply claims a change that no action receipt confirms"],
    );
    claimsActionMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await finish(
      "The review is in. Nothing was posted, drafted 3 options for you. No posts were published, saved the draft instead. It was not drafted or posted yet.",
      true,
    );
    expect(buildActionResponseMock.mock.calls[0][4].message).toBe(
      "The review is in. It was not drafted or posted yet.",
    );
  });

  it("does not keep a claim because an earlier clause is negative", async () => {
    expectCoreLogWhys(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
      ["The reply claims a change that no action receipt confirms"],
    );
    claimsActionMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await finish(
      "The research is in. No one objected, so I created the schedule. Nothing was posted, I drafted it for you.",
      true,
    );
    expect(buildActionResponseMock.mock.calls[0][4].message).toBe(
      "The research is in.",
    );
  });

  it("keeps individually cleared sentences when the final recheck cannot run", async () => {
    expectCoreLogWhys(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
      ["The reply claims a change that no action receipt confirms"],
    );
    claimsActionMock.mockResolvedValueOnce(true).mockResolvedValueOnce(null);
    claimsActionBySentenceMock.mockResolvedValueOnce([false, true]);
    await finish(
      "Your Padierfind project has an X account. I created the schedule.",
      true,
    );
    expect(buildActionResponseMock.mock.calls[0][4]).toMatchObject({
      message: "Your Padierfind project has an X account.",
      replyCheck: "cut",
    });
  });

  it("keeps a true blocker when it cuts an unconfirmed claim", async () => {
    expectCoreLogWhys(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
      ["The reply claims a change that no action receipt confirms"],
    );
    claimsActionMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await finish(
      "I sent the brief to Hannah. No posts have been drafted because the account still needs approval. I created the schedule. I scheduled the post, which needs your approval.",
      true,
    );
    expect(buildActionResponseMock.mock.calls[0][4].message).toBe(
      "No posts have been drafted because the account still needs approval.",
    );
  });

  it("drops what is left when it still claims a change", async () => {
    expectCoreLogWhys(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
      ["The reply claims a change that no action receipt confirms"],
    );
    claimsActionMock.mockResolvedValue(true);
    await finish("Hannah is on it now. I created the schedule.", true);
    expect(buildActionResponseMock.mock.calls[0][4].message).toBeNull();
  });

  it("drops only the unsupported scheduling sentence and preserves confirmed draft summary + bullets", async () => {
    expectCoreLogWhys(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
      ["The reply claims a change that no action receipt confirms"],
    );
    toolCallFind.mockResolvedValue([
      {
        capability: "create_social_post",
        result: {
          id: "post-1",
          status: "NEEDS_APPROVAL",
          scheduledAt: null,
        },
      },
    ]);
    claimsActionMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    claimsActionBySentenceMock.mockResolvedValueOnce([
      false,
      false,
      false,
      true,
      false,
    ]);

    const reply = [
      "I prepared three X drafts from the one-pager:",
      "- Draft 1: Typed memory replaces stale notes automatically.",
      "- Draft 2: Nightly dream runs keep memory clean.",
      "They are spread across Monday, Wednesday, and Friday next week.",
      "Approve them in the cards below when ready.",
    ].join("\n");

    await finish(reply, true);

    expect(claimsActionMock).toHaveBeenNthCalledWith(1, reply, [
      "Created social post (draft awaiting approval; not scheduled)",
    ]);
    expect(buildActionResponseMock.mock.calls[0][4]).toMatchObject({
      message: [
        "I prepared three X drafts from the one-pager:",
        "- Draft 1: Typed memory replaces stale notes automatically.",
        "- Draft 2: Nightly dream runs keep memory clean.",
        "Approve them in the cards below when ready.",
      ].join("\n"),
      replyCheck: "cut",
    });
  });

  it("prunes only the unsupported clause from a single mixed sentence", async () => {
    expectCoreLogWhys(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
      ["The reply claims a change that no action receipt confirms"],
    );
    toolCallFind.mockResolvedValue([
      {
        capability: "create_social_post",
        result: {
          id: "post-1",
          status: "NEEDS_APPROVAL",
          scheduledAt: null,
        },
      },
    ]);
    claimsActionMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    claimsActionBySentenceMock
      .mockResolvedValueOnce([true])
      .mockResolvedValueOnce([false, true]);

    await finish(
      "I drafted three X posts from the one-pager, and scheduled them for Monday, Wednesday, and Friday.",
      true,
    );

    expect(buildActionResponseMock.mock.calls[0][4]).toMatchObject({
      message: "I drafted three X posts from the one-pager.",
      replyCheck: "cut",
    });
  });

  it("withholds an unverified remainder when all sentence checks and the recheck time out", async () => {
    expectCoreLogWhys(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
      ["The reply claims a change that no action receipt confirms"],
    );
    claimsActionMock.mockResolvedValueOnce(true).mockResolvedValueOnce(null);
    claimsActionBySentenceMock.mockResolvedValueOnce([null, null]);
    await finish("I created a task. I forwarded the invoice to Finance.", true);
    expect(buildActionResponseMock.mock.calls[0][4]).toMatchObject({
      message: null,
      replyCheck: "cut",
    });
  });

  it("does not restore an unchanged reply already rejected as a whole", async () => {
    expectCoreLogWhys(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
      ["The reply claims a change that no action receipt confirms"],
    );
    claimsActionMock.mockResolvedValueOnce(true);
    claimsActionBySentenceMock.mockResolvedValueOnce([null]);
    await finish("I forwarded the invoice to Finance.", true);
    expect(buildActionResponseMock.mock.calls[0][4]).toMatchObject({
      message: null,
      replyCheck: "cut",
    });
  });

  it("does not restore an individually rejected sentence after a recheck outage", async () => {
    expectCoreLogWhys(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
      ["The reply claims a change that no action receipt confirms"],
    );
    claimsActionMock.mockResolvedValueOnce(true).mockResolvedValueOnce(null);
    claimsActionBySentenceMock.mockResolvedValueOnce([true, true]);
    await finish("I created a task. I forwarded the invoice to Finance.", true);
    expect(buildActionResponseMock.mock.calls[0][4]).toMatchObject({
      message: null,
      replyCheck: "cut",
    });
  });

  it("keeps only positively cleared sentences when later sentences are unchecked due to budget exhaustion", async () => {
    expectCoreLogWhys(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
      ["The reply claims a change that no action receipt confirms"],
    );
    claimsActionMock.mockResolvedValueOnce(true).mockResolvedValueOnce(null);
    claimsActionBySentenceMock.mockResolvedValueOnce([false, true, null]);

    await finish(
      "The file is ready for review. I scheduled the posts. I forwarded the invoice to Finance.",
      true,
    );

    expect(buildActionResponseMock.mock.calls[0][4]).toMatchObject({
      message: "The file is ready for review.",
      replyCheck: "cut",
    });
  });

  it("falls back to strictly cut deterministic scrub when per-sentence check is unavailable and recheck passes", async () => {
    expectCoreLogWhys(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
      ["The reply claims a change that no action receipt confirms"],
    );
    claimsActionMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    claimsActionBySentenceMock.mockResolvedValueOnce([null, null]);

    await finish(
      "The file is ready for review. I scheduled the posts for next week.",
      true,
    );

    expect(buildActionResponseMock.mock.calls[0][4]).toMatchObject({
      message: "The file is ready for review.",
      replyCheck: "cut",
    });
  });

  it("still drops a reply when every sentence and clause is an unconfirmed claim", async () => {
    expectCoreLogWhys(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
      ["The reply claims a change that no action receipt confirms"],
    );
    claimsActionMock.mockResolvedValueOnce(true);
    claimsActionBySentenceMock
      .mockResolvedValueOnce([true])
      .mockResolvedValueOnce([true, true]);

    await finish("I created the task, and I assigned it to Hannah.", true);

    expect(buildActionResponseMock.mock.calls[0][4]).toMatchObject({
      message: null,
      replyCheck: "cut",
    });
  });

  it("passes planned-time draft state to confirmedChanges when scheduledAt is set", async () => {
    toolCallFind.mockResolvedValue([
      {
        capability: "create_social_post",
        result: {
          id: "post-1",
          status: "NEEDS_APPROVAL",
          scheduledAt: "2026-12-01T09:00:00.000Z",
        },
      },
    ]);
    claimsActionMock.mockResolvedValueOnce(false);

    await finish("Created a draft awaiting approval with planned time.", true);

    expect(claimsActionMock).toHaveBeenCalledWith(
      "Created a draft awaiting approval with planned time.",
      ["Created social post (draft awaiting approval; planned time set)"],
    );
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

  it("confirms a chat strategy change only as a version awaiting approval", async () => {
    // Run 01a2186c: three saves of an unapproved version, no post moved,
    // and Cuso answered "Done".
    const v1 = "0196a000-0000-7000-8000-0000000000a1";
    const v2 = "0196a000-0000-7000-8000-0000000000a2";
    toolCallFind.mockResolvedValue([
      {
        capability: "write_strategy",
        result: { written: true, versionId: v2 },
      },
      {
        capability: "save_strategy",
        result: { saved: "strategy", versionId: v2, approved: false },
      },
      {
        capability: "save_strategy",
        result: { saved: "strategy", versionId: v1, approved: true },
      },
      {
        capability: "save_strategy",
        result: { saved: "strategy", versionId: "not-a-uuid" },
      },
    ]);
    strategyFind.mockResolvedValue([{ id: v2 }]);
    await finish("Done, the update is in the card below.", true);
    // Each version once, and never a value Postgres would refuse as a uuid.
    expect(strategyFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [v2, v1] }, approvedAt: null },
      }),
    );
    expect(claimsActionMock).toHaveBeenCalledWith(
      "Done, the update is in the card below.",
      [PENDING_STRATEGY_LABEL, "Saved marketing strategy"],
    );
  });

  describe("when the check cannot run", () => {
    beforeEach(() => {
      expectCoreLogWhys(
        "warn",
        "Showed a Soko Bot reply its claim check could not check",
        ["The check for claims of unconfirmed changes could not run"],
      );
      claimsActionMock.mockResolvedValue(null);
    });

    it("shows the reply, never withholds it", async () => {
      await finish("Here is what I found: two X accounts.", true);
      const narrative = buildActionResponseMock.mock.calls[0][4];
      expect(narrative.message).toBe("Here is what I found: two X accounts.");
      expect(narrative.replyCheck).toBe("unchecked");
    });

    it("never lets an unconfirmed claim through", async () => {
      // Joseph's prod turn: only a message was sent.
      await finish(
        "I created the weekly schedule and drafted three posts.",
        true,
      );
      expect(buildActionResponseMock.mock.calls[0][4]).toMatchObject({
        message: null,
        replyCheck: "unchecked",
      });
    });

    it("cuts the claim from a reply at the length limit, keeping the rest", async () => {
      const body = [
        "I created the weekly schedule.",
        ...Array.from(
          { length: 160 },
          (_, i) =>
            `Week ${i + 1}: the team is reviewing the available time slots.`,
        ),
      ]
        .join("\n")
        .slice(0, 7_960);
      await finish(body, true);
      const message = buildActionResponseMock.mock.calls[0][4].message;
      expect(message).not.toContain("I created the weekly schedule.");
      expect(message).toContain("Week 1: the team is reviewing");
      expect(message.length).toBeLessThanOrEqual(8_000);
    });
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
    id: "turn-direct",
    sokoBotId: "bot-1",
    workspaceId: "ws-1",
    versionId: "v36" as string | null,
    source: "CHAT",
    clientTurnId: "chat:1",
    parentTurnId: null as string | null,
    askedByUserId: null as string | null,
    requestedByUserId: "owner-1",
    chainDepth: 0,
    sokoBot: { userId: "owner-1" as string | null },
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

  it("requires an owner CHAT root for background children and rejects INGEST, EVENT, or cross-bot children", async () => {
    // Background run started from owner CHAT
    turnFind.mockResolvedValue({
      ...ownerChat,
      id: "child-of-chat",
      parentTurnId: "root-chat",
      parentTurn: { ...ownerChat, id: "root-chat" },
    });
    expect(await isOwnerDirected("child-of-chat")).toBe(true);

    // Grandchild whose root is owner CHAT
    turnFind
      .mockResolvedValueOnce({
        ...ownerChat,
        id: "grandchild-of-chat",
        parentTurnId: "child-1",
        parentTurn: { ...ownerChat, id: "child-1", parentTurnId: "root-chat" },
      })
      .mockResolvedValueOnce({
        ...ownerChat,
        id: "root-chat",
        parentTurnId: null,
      });
    expect(await isOwnerDirected("grandchild-of-chat")).toBe(true);

    // Cross-bot or cross-workspace parent spoof fails closed
    turnFind.mockResolvedValue({
      ...ownerChat,
      id: "child-cross-bot",
      parentTurnId: "other-bot-chat",
      parentTurn: {
        ...ownerChat,
        id: "other-bot-chat",
        sokoBotId: "bot-other",
      },
    });
    expect(await isOwnerDirected("child-cross-bot")).toBe(false);

    turnFind.mockResolvedValue({
      ...ownerChat,
      id: "child-cross-ws",
      parentTurnId: "other-ws-chat",
      parentTurn: {
        ...ownerChat,
        id: "other-ws-chat",
        workspaceId: "ws-other",
      },
    });
    expect(await isOwnerDirected("child-cross-ws")).toBe(false);

    // Background run started from non-owner INGEST (must stay blocked)
    turnFind.mockResolvedValue({
      ...ownerChat,
      id: "child-of-ingest",
      source: "INGEST",
      parentTurnId: "root-ingest",
      parentTurn: { ...ownerChat, id: "root-ingest", source: "INGEST" },
    });
    expect(await isOwnerDirected("child-of-ingest")).toBe(false);

    // Even if a child claims source CHAT, an INGEST parent fails closed
    turnFind.mockResolvedValue({
      ...ownerChat,
      id: "chat-child-of-ingest",
      parentTurnId: "root-ingest",
      parentTurn: { ...ownerChat, id: "root-ingest", source: "INGEST" },
    });
    expect(await isOwnerDirected("chat-child-of-ingest")).toBe(false);

    // Grandchild whose root is INGEST fails closed
    turnFind
      .mockResolvedValueOnce({
        ...ownerChat,
        id: "grandchild-of-ingest",
        parentTurnId: "child-1",
        parentTurn: {
          ...ownerChat,
          id: "child-1",
          parentTurnId: "root-ingest",
        },
      })
      .mockResolvedValueOnce({
        ...ownerChat,
        id: "root-ingest",
        source: "INGEST",
        parentTurnId: null,
      });
    expect(await isOwnerDirected("grandchild-of-ingest")).toBe(false);

    // Autonomous EVENT child hung under an owner CHAT (e.g. CMO production)
    turnFind.mockResolvedValue({
      ...ownerChat,
      id: "event-child-of-chat",
      source: "EVENT",
      parentTurnId: "root-chat",
      parentTurn: { ...ownerChat, id: "root-chat" },
    });
    expect(await isOwnerDirected("event-child-of-chat")).toBe(false);

    // Cycle or missing parent fails closed
    turnFind.mockResolvedValue({
      ...ownerChat,
      id: "self-cycle",
      parentTurnId: "self-cycle",
      parentTurn: {
        ...ownerChat,
        id: "self-cycle",
        parentTurnId: "self-cycle",
      },
    });
    expect(await isOwnerDirected("self-cycle")).toBe(false);
  });

  it("allows owner-directed tainted drafts and newsletters while blocking scheduled posts, paid investor research, outward social actions, and INGEST children", async () => {
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

    // Input-aware taint gates: unscheduled draft allowed, scheduledAt blocked;
    // free investor_warm_paths read allowed, paid research: true blocked.
    expect(
      await isTaintBlocked("turn-direct", "create_social_post", {
        text: "Draft for owner approval",
      }),
    ).toBe(false);
    expect(
      await isTaintBlocked("turn-direct", "create_social_post", {
        text: "Scheduled post",
        scheduledAt: "2026-12-01T09:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      await isTaintBlocked("turn-direct", "investor_warm_paths", {
        contactId: "01960001-0001-7001-8001-000000000001",
        research: false,
      }),
    ).toBe(false);
    expect(
      await isTaintBlocked("turn-direct", "investor_warm_paths", {
        contactId: "01960001-0001-7001-8001-000000000001",
        research: true,
      }),
    ).toBe(true);

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
      id: "event-child-of-chat",
      source: "EVENT",
      parentTurnId: "root-chat",
      parentTurn: { ...ownerChat, id: "root-chat" },
    });
    for (const blocked of [
      "create_social_post",
      "update_social_post",
      "update_social_posts",
    ] as const) {
      expect(await isTaintBlocked("event-child-of-chat", blocked)).toBe(true);
    }

    // Background child of an INGEST turn must remain blocked on every tainted write
    turnFind.mockResolvedValue({
      ...ownerChat,
      id: "child-of-ingest",
      parentTurnId: "root-ingest",
      parentTurn: { ...ownerChat, id: "root-ingest", source: "INGEST" },
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
