import { createGateway, stepCountIs, tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  MODEL_CALL_MAX_MS,
  MODEL_STREAM_IDLE_MS,
  ModelStreamStalledError,
  streamModelCall,
} from "@/lib/soko-bot/stream-model-call";

const {
  authorizeMock,
  createEventMock,
  executeToolMock,
  findFirstEventMock,
  fetchMock,
  toolCallUpsertMock,
  toolCallUpdateManyMock,
  turnFindUniqueMock,
} = vi.hoisted(() => ({
  turnFindUniqueMock: vi.fn(),
  toolCallUpsertMock: vi.fn(),
  toolCallUpdateManyMock: vi.fn(),
  authorizeMock: vi.fn(),
  createEventMock: vi.fn(),
  executeToolMock: vi.fn(),
  findFirstEventMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({ AI_GATEWAY_API_KEY: "gateway-key" }),
}));
vi.mock("@/lib/db/prisma", () => {
  const client = {
    sokoBotRuntimeEvent: {
      create: createEventMock,
      findFirst: findFirstEventMock,
    },
    sokoBotTurn: { findUnique: turnFindUniqueMock },
    sokoBotToolCall: {
      upsert: toolCallUpsertMock,
      updateMany: toolCallUpdateManyMock,
    },
  };
  return {
    default: {
      ...client,
      // The event log's locked append: the same models, plus the lock.
      $transaction: (operation: (tx: unknown) => Promise<unknown>) =>
        operation({ ...client, $executeRaw: vi.fn() }),
    },
  };
});
vi.mock("@/services/soko-bot-runtime.service", () => ({
  sokoBotRuntimeService: {
    authorize: authorizeMock,
    executeTool: executeToolMock,
  },
}));
vi.mock("@/services/soko-bot-version.service", () => ({
  resolveRunnableSokoBotVersion: vi.fn().mockResolvedValue({
    model: "google/gemini-3.6-flash",
    inferenceRegion: "eu",
  }),
}));
vi.mock("@/lib/soko-bot/sandbox/sandbox-runtime", () => ({
  stopTurnSandbox: vi.fn(),
}));

import {
  proxySandboxModelCall,
  recordSandboxAction,
  recordSandboxActionResult,
  runSandboxTool,
} from "./soko-bot-sandbox-turn.service";

const claims = {
  turnId: "01960001-0001-7001-8001-000000000001",
  sessionId: "sess_1",
  expiresAt: Date.now() + 60_000,
};

function events(): { type: string; data: Record<string, unknown> }[] {
  return createEventMock.mock.calls.map((call) => call[0].data);
}

function modelRequest(overrides: Record<string, string> = {}) {
  return {
    headers: new Headers({
      "ai-language-model-id": "google/gemini-3.6-flash",
      "ai-language-model-streaming": "true",
      "ai-language-model-specification-version": "4",
      ...overrides,
    }),
    body: JSON.stringify({
      prompt: [],
      providerOptions: { gateway: { only: ["openai"] } },
    }),
  };
}

function headersTimeoutError() {
  return Object.assign(new Error("Headers Timeout Error"), {
    name: "HeadersTimeoutError",
    code: "UND_ERR_HEADERS_TIMEOUT",
  });
}

/** The Gateway's streamed answer: one SSE `data:` line per part. */
function sse(parts: unknown[]): string {
  return parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("");
}

const FINISH = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 1_000, cacheRead: 200 },
    outputTokens: { total: 50 },
  },
  providerMetadata: {
    gateway: {
      cost: "0.004",
      routing: { finalProvider: "vertex" },
    },
  },
};

function gatewayAnswer(parts: unknown[] = []) {
  return new Response(sse([...parts, FINISH]), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("sandbox turn service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    findFirstEventMock.mockResolvedValue(null);
    turnFindUniqueMock.mockResolvedValue(null);
    createEventMock.mockResolvedValue({});
    authorizeMock.mockResolvedValue({
      turn: { id: claims.turnId, versionId: "v16" },
      grant: {
        capabilities: [
          "web_fetch",
          "post_chat",
          "update_plan",
          "workspace_write",
        ],
      },
    });
  });

  it("marks the 409 of a turn that is no longer active, so the runner stops", async () => {
    authorizeMock.mockRejectedValueOnce(new Error("Turn was cancelled"));
    await expect(
      recordSandboxAction(claims, {
        name: "web_fetch",
        toolCallId: "call_1",
        toolInput: {},
      }),
    ).rejects.toMatchObject({
      status: 409,
      cause: { kind: "soko_bot_turn_inactive" },
    });
  });

  it("refuses an unstreamed call and any model but the turn's", async () => {
    await expect(
      proxySandboxModelCall(
        claims,
        modelRequest({ "ai-language-model-streaming": "false" }),
      ),
    ).rejects.toThrow("must stream");
    await expect(
      proxySandboxModelCall(
        claims,
        modelRequest({ "ai-language-model-id": "openai/gpt-5.5" }),
      ),
    ).rejects.toThrow("not this turn's");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards with Core's key and EU routing, and meters the step itself", async () => {
    fetchMock.mockResolvedValue(gatewayAnswer());
    const result = await proxySandboxModelCall(
      claims,
      modelRequest({ "ai-o11y-sneaky": "x" }),
    );

    expect(result.status).toBe(200);
    expect(result.contentType).toBe("text/event-stream");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentHeaders = new Headers(init.headers);
    expect(sentHeaders.get("ai-language-model-streaming")).toBe("true");
    expect(sentHeaders.get("authorization")).toBe("Bearer gateway-key");
    expect(sentHeaders.get("ai-o11y-sneaky")).toBeNull();
    const sent = JSON.parse(String(init.body));
    // Core's provider options replace the runner's entirely.
    expect(Object.keys(sent.providerOptions)).toEqual(["gateway"]);
    expect(sent.providerOptions.gateway.only).not.toContain("openai");
    expect(sent.providerOptions.gateway.inferenceRegion).toBeDefined();
    expect(events().map((event) => event.type)).toEqual([
      "step.started",
      "step.completed",
    ]);
    expect(events()[1]?.data).toMatchObject({
      usage: {
        inputTokens: 1_000,
        outputTokens: 50,
        cacheReadTokens: 200,
        costUsd: 0.004,
      },
    });
  });

  it("passes the runner's reasoning-summary switches through, and nothing else", async () => {
    fetchMock.mockResolvedValue(gatewayAnswer());
    await proxySandboxModelCall(claims, {
      ...modelRequest(),
      body: JSON.stringify({
        prompt: [],
        providerOptions: {
          gateway: { only: ["openai"] },
          openai: { reasoningSummary: "auto", store: true },
          google: {
            thinkingConfig: { includeThoughts: true, thinkingBudget: 99 },
          },
          anthropic: { thinking: { type: "enabled" } },
        },
      }),
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(String(init.body));
    expect(sent.providerOptions.openai).toEqual({ reasoningSummary: "auto" });
    expect(sent.providerOptions.google).toEqual({
      thinkingConfig: { includeThoughts: true },
    });
    expect(sent.providerOptions).not.toHaveProperty("anthropic");
    expect(sent.providerOptions.gateway.only).not.toContain("openai");
  });

  it("still meters a call whose region is rejected", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        sse([
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "post_chat",
            input: "{}",
          },
          {
            type: "finish",
            usage: { inputTokens: 10, outputTokens: 1 },
            providerMetadata: {
              gateway: {
                cost: "0.001",
                routing: {
                  modelAttempts: [
                    {
                      providerAttempts: [
                        {
                          provider: "openai",
                          inferenceEndpoint: { geoRegion: "us" },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        ]),
        { status: 200 },
      ),
    );
    await expect(
      proxySandboxModelCall(claims, modelRequest()),
    ).rejects.toMatchObject({ status: 502 });
    expect(events().map((event) => event.type)).toContain("step.completed");
  });

  /** A Gateway answer that sends one part every `gapMs`, then maybe stalls. */
  function slowGateway(parts: unknown[], gapMs: number, stall = false) {
    const encoder = new TextEncoder();
    const cancelled = vi.fn();
    fetchMock.mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              for (const part of parts) {
                await new Promise((resolve) => setTimeout(resolve, gapMs));
                controller.enqueue(encoder.encode(sse([part])));
              }
              if (!stall) controller.close();
            },
            cancel: cancelled,
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    );
    return { cancelled };
  }

  /** The runner's own Gateway client, pointed at Core's proxy. */
  function runnerGateway() {
    return createGateway({
      baseURL: "https://core.test/gateway",
      apiKey: "sandbox",
      fetch: async (_url, init) => {
        const proxied = await proxySandboxModelCall(claims, {
          headers: new Headers(init?.headers),
          body: String(init?.body),
        });
        return new Response(proxied.body, {
          status: proxied.status,
          headers: { "content-type": proxied.contentType },
        });
      },
    });
  }

  it("runs one long tool call that streams for minutes, metered once", async () => {
    // The preview's failing step: one upload_file call carrying a whole
    // month's calendar. A non-streamed Gateway call dies at about 60 seconds;
    // this one arrives over two and a half minutes.
    const content = Array.from(
      { length: 30 },
      (_, day) => `Day ${day + 1}: ${"draft ".repeat(16)}`,
    );
    const input = JSON.stringify({
      name: "calendar.md",
      content: content.join(""),
    });
    const slices = input.match(/.{1,200}/g) ?? [];
    slowGateway(
      [
        { type: "tool-input-start", id: "call_1", toolName: "save_file" },
        ...slices.map((delta) => ({
          type: "tool-input-delta",
          id: "call_1",
          delta,
        })),
        { type: "tool-input-end", id: "call_1" },
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "save_file",
          input,
        },
        {
          ...FINISH,
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
        },
      ],
      10_000,
    );
    const execute = vi.fn(
      async (_input: { name: string; content: string }) => ({ saved: true }),
    );

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const pending = streamModelCall({
        model: runnerGateway()("google/gemini-3.6-flash"),
        prompt: "Save the month's calendar as one file",
        maxRetries: 0,
        tools: {
          save_file: tool({
            inputSchema: z.object({ name: z.string(), content: z.string() }),
            execute,
          }),
        },
        stopWhen: stepCountIs(1),
      });
      await vi.advanceTimersByTimeAsync((slices.length + 5) * 10_000);
      const result = await pending;
      expect(result.finishReason).toBe("tool-calls");
    } finally {
      vi.useRealTimers();
    }
    expect(slices.length * 10_000).toBeGreaterThan(120_000);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toEqual(JSON.parse(input));
    expect(events().map((event) => event.type)).toEqual([
      "step.started",
      "step.completed",
    ]);
    expect(events()[1]?.data).toMatchObject({
      usage: { inputTokens: 1_000, outputTokens: 50, costUsd: 0.004 },
    });
  });

  it("fails a stalled Gateway stream fast with a 502 the runner retries", async () => {
    // The preview hit this: the Gateway left a streamed answer open and
    // silent, and Core waited until Vercel killed it at 300 seconds.
    const { cancelled } = slowGateway(
      [{ type: "tool-input-start", id: "call_1", toolName: "save_file" }],
      1_000,
      true,
    );

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const settled = proxySandboxModelCall(claims, modelRequest()).then(
        () => expect.unreachable("expected 502"),
        (caught: unknown) => caught,
      );
      await vi.advanceTimersByTimeAsync(MODEL_STREAM_IDLE_MS + 2_000);
      const error = await settled;
      expect(error).toMatchObject({ status: 502 });
      expect((error as Error).cause).toBeInstanceOf(ModelStreamStalledError);
    } finally {
      vi.useRealTimers();
    }
    expect(cancelled).toHaveBeenCalled();
    expect(events().map((event) => event.type)).toEqual(["step.started"]);
  });

  it("gives every Gateway call a deadline inside Core's function limit", async () => {
    fetchMock.mockResolvedValue(gatewayAnswer());
    await proxySandboxModelCall(claims, modelRequest());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(MODEL_CALL_MAX_MS).toBeLessThan(300_000);
  });

  it("keeps a stream that broke off from the runner, unmetered", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        sse([
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "post_chat",
            input: "{}",
          },
          { type: "error", error: { message: "Provider overloaded" } },
        ]),
        { status: 200 },
      ),
    );
    await expect(
      proxySandboxModelCall(claims, modelRequest()),
    ).rejects.toMatchObject({ status: 502 });
    expect(events().map((event) => event.type)).toEqual(["step.started"]);
  });

  it("answers the runner's own Gateway client with a stream it can read", async () => {
    fetchMock.mockResolvedValue(
      gatewayAnswer([
        { type: "text-start", id: "answer" },
        { type: "text-delta", id: "answer", delta: "Hi Patrick." },
        { type: "text-end", id: "answer" },
      ]),
    );
    const result = await streamModelCall({
      model: runnerGateway()("google/gemini-3.6-flash"),
      prompt: "hi",
      maxRetries: 0,
    });

    expect(result.text).toBe("Hi Patrick.");
    expect(result.steps).toHaveLength(1);
    expect(
      events().filter((event) => event.type === "step.completed"),
    ).toHaveLength(1);
  });

  it("passes a Gateway error through with its status", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Rate limited" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      proxySandboxModelCall(claims, modelRequest()),
    ).resolves.toMatchObject({ status: 429, contentType: "application/json" });
    expect(events().map((event) => event.type)).toEqual(["step.started"]);
  });

  it("maps an AI Gateway fetch timeout to 502 instead of an unexpected 500", async () => {
    const fetchFailed = Object.assign(new TypeError("fetch failed"), {
      cause: headersTimeoutError(),
    });
    fetchMock.mockRejectedValue(fetchFailed);
    const error = await proxySandboxModelCall(claims, modelRequest()).then(
      () => expect.unreachable("expected 502"),
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ status: 502 });
    expect((error as Error).cause).toBe(fetchFailed);
    expect(((error as Error).cause as Error).cause).toMatchObject({
      name: "HeadersTimeoutError",
      code: "UND_ERR_HEADERS_TIMEOUT",
    });
  });

  it("maps a bare undici headers timeout to 502", async () => {
    const timeout = headersTimeoutError();
    fetchMock.mockRejectedValue(timeout);
    const error = await proxySandboxModelCall(claims, modelRequest()).then(
      () => expect.unreachable("expected 502"),
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ status: 502 });
    expect((error as Error).cause).toBe(timeout);
  });

  it("does not map an unrelated TypeError to 502", async () => {
    const boom = new TypeError("Cannot read properties of undefined");
    fetchMock.mockRejectedValue(boom);
    await expect(proxySandboxModelCall(claims, modelRequest())).rejects.toBe(
      boom,
    );
  });

  it("drops zero retention only for the Gateway-run search call", async () => {
    const { resolveRunnableSokoBotVersion } = await import(
      "@/services/soko-bot-version.service"
    );
    const luna = { model: "openai/gpt-6-luna", inferenceRegion: undefined };
    for (let call = 0; call < 3; call++)
      vi.mocked(resolveRunnableSokoBotVersion).mockResolvedValueOnce(
        luna as never,
      );
    fetchMock.mockImplementation(async () => gatewayAnswer());
    const lunaHeaders = { "ai-language-model-id": "openai/gpt-6-luna" };
    const search = modelRequest(lunaHeaders);
    const searchCall = {
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Search the web for: TOKEN2049" }],
        },
      ],
      tools: [
        {
          type: "provider",
          name: "perplexity_search",
          id: "gateway.perplexity_search",
          args: { maxResults: 5 },
        },
      ],
      toolChoice: { type: "tool", toolName: "perplexity_search" },
    };
    search.body = JSON.stringify(searchCall);
    // The same tool with the conversation around it is not a search call.
    const disguised = modelRequest(lunaHeaders);
    disguised.body = JSON.stringify({
      ...searchCall,
      prompt: [
        { role: "system", content: "Owner memory: …" },
        ...searchCall.prompt,
      ],
    });
    await proxySandboxModelCall(claims, search);
    await proxySandboxModelCall(claims, modelRequest(lunaHeaders));
    await proxySandboxModelCall(claims, disguised);
    const [searchBody, turnBody, disguisedBody] = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)),
    );
    expect(searchBody.providerOptions.gateway).toEqual({
      disallowPromptTraining: true,
    });
    const both = { zeroDataRetention: true, disallowPromptTraining: true };
    expect(turnBody.providerOptions.gateway).toEqual(both);
    expect(disguisedBody.providerOptions.gateway).toEqual(both);
  });

  it("marks the turn once the Gateway ran a web search", async () => {
    fetchMock.mockResolvedValue(
      gatewayAnswer([
        {
          type: "tool-result",
          toolCallId: "search_1",
          toolName: "web_search",
          result: {},
        },
      ]),
    );
    await proxySandboxModelCall(claims, modelRequest());
    expect(events().map((event) => event.type)).toContain(
      "sandbox.untrusted_input",
    );
  });

  it("marks the turn before a sandbox tool runs, but not for the plan or a file it writes", async () => {
    await recordSandboxAction(claims, {
      name: "update_plan",
      toolCallId: "c1",
      toolInput: { steps: [] },
    });
    expect(events().map((event) => event.type)).toEqual(["actions.requested"]);
    // Writing down what the bot has brings in no input, so "write the notes
    // and put them in my Files" is not refused halfway.
    await recordSandboxAction(claims, {
      name: "workspace_write",
      toolCallId: "c0",
      toolInput: { path: "notes.md", content: "- one" },
    });
    expect(events().map((event) => event.type)).toEqual([
      "actions.requested",
      "actions.requested",
    ]);
    createEventMock.mockClear();

    await recordSandboxAction(claims, {
      name: "web_fetch",
      toolCallId: "c2",
      toolInput: { url: "https://example.com" },
    });
    expect(events().map((event) => event.type)).toEqual([
      "sandbox.untrusted_input",
      "actions.requested",
    ]);
  });

  it("records a sandbox tool as a tool call with what it could cite", async () => {
    await recordSandboxAction(claims, {
      name: "web_fetch",
      toolCallId: "c9",
      toolInput: { url: "https://example.com" },
    });
    expect(toolCallUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          toolCallId: "c9",
          capability: "web_fetch",
          input: { url: "https://example.com" },
        }),
        update: {},
      }),
    );
    expect(toolCallUpsertMock.mock.calls[0][0].create).not.toHaveProperty(
      "actorBotId",
    );

    await recordSandboxActionResult(claims, {
      name: "web_fetch",
      toolCallId: "c9",
      status: "completed",
      output: '{"url":"https://example.com","status":200,"text":"Hi"}',
      sources: ["https://example.com"],
    });
    expect(toolCallUpdateManyMock).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        toolCallId: "c9",
        capability: "web_fetch",
        status: "PENDING",
      }),
      data: {
        status: "COMPLETED",
        result: {
          output: '{"url":"https://example.com","status":200,"text":"Hi"}',
          sources: ["https://example.com"],
        },
      },
    });

    await recordSandboxActionResult(claims, {
      name: "web_fetch",
      toolCallId: "c10",
      status: "failed",
      output: '{"error":"fetch failed"}',
    });
    expect(toolCallUpdateManyMock.mock.calls.at(-1)?.[0].data).toMatchObject({
      status: "FAILED",
      errorDetail: '{"error":"fetch failed"}',
    });

    // A failure can echo a credential; it is redacted before it is stored.
    await recordSandboxActionResult(claims, {
      name: "web_fetch",
      toolCallId: "c12",
      status: "failed",
      output:
        "401 from https://api.example.com with Authorization: Bearer fake-test-credential-4f9a2c7e1b8d",
    });
    const redacted = toolCallUpdateManyMock.mock.calls.at(-1)?.[0].data;
    expect(redacted.status).toBe("FAILED");
    expect(redacted.errorDetail).not.toContain("fake-test-credential");
  });

  it("settles only sandbox tools from the runner", async () => {
    await expect(
      recordSandboxActionResult(claims, {
        name: "hire_agent",
        toolCallId: "c11",
        status: "failed",
      }),
    ).rejects.toThrow("Not a sandbox tool");
    expect(toolCallUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ toolCallId: "c11" }),
      }),
    );
  });

  it("refuses a sandbox tool the turn was not granted", async () => {
    await expect(
      recordSandboxAction(claims, {
        name: "bash",
        toolCallId: "c3",
        toolInput: { command: "id" },
      }),
    ).rejects.toThrow("not granted");
  });

  it("keeps sandbox tools off the Sokosumi tool path", async () => {
    await expect(
      runSandboxTool(claims, {
        capability: "bash",
        toolCallId: "c4",
        toolInput: { command: "id" },
      }),
    ).rejects.toThrow("Unknown Sokosumi tool");
  });

  it("gives a script's read its own call id and the bare result", async () => {
    executeToolMock.mockResolvedValue({ messages: [], nextPageToken: null });
    const result = await runSandboxTool(claims, {
      capability: "search_inbox",
      toolInput: { query: "in:sent" },
    });
    expect(result).toEqual({ messages: [], nextPageToken: null });
    expect(executeToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "search_inbox",
        toolCallId: expect.stringMatching(/^script:/),
      }),
    );
  });

  it("refuses a script's outward action after the turn read the web", async () => {
    findFirstEventMock.mockResolvedValue({ id: "taint" });
    await expect(
      runSandboxTool(claims, { capability: "post_chat", toolInput: {} }),
    ).rejects.toThrow("ask the owner in chat");
    expect(executeToolMock).not.toHaveBeenCalled();
  });

  it("refuses an outward action after the turn read the web", async () => {
    findFirstEventMock.mockResolvedValue({ id: "taint" });
    await expect(
      runSandboxTool(claims, {
        capability: "post_chat",
        toolCallId: "c5",
        toolInput: {},
      }),
    ).rejects.toThrow("ask the owner in chat");
    expect(executeToolMock).not.toHaveBeenCalled();
  });

  it("lets work the owner asked for brief a Coworker after reading the web", async () => {
    findFirstEventMock.mockResolvedValue({ id: "taint" });
    turnFindUniqueMock.mockResolvedValue({
      source: "CHAT",
      parentTurnId: null,
      askedByUserId: null,
      chainDepth: 0,
      chatMentionId: "mention",
    });
    executeToolMock.mockResolvedValue({ ok: true });
    await runSandboxTool(claims, {
      capability: "assign_task",
      toolCallId: "c6",
      toolInput: { taskId: "task", coworkerId: "hannah" },
    });
    expect(executeToolMock).toHaveBeenCalledOnce();
  });

  it("lets a background run save to Files after running a command, but not post to others", async () => {
    findFirstEventMock.mockResolvedValue({ id: "taint" });
    turnFindUniqueMock.mockResolvedValue({
      source: "CHAT",
      parentTurnId: "parent",
      askedByUserId: null,
      chainDepth: 0,
      chatMentionId: null,
    });
    executeToolMock.mockResolvedValue({ ok: true });
    await runSandboxTool(claims, {
      capability: "upload_file",
      toolCallId: "c7",
      toolInput: { filename: "index.html", content: "<h1>Hi</h1>" },
    });
    await expect(
      runSandboxTool(claims, {
        capability: "post_chat",
        toolCallId: "c8",
        toolInput: {},
      }),
    ).rejects.toThrow("ask the owner in chat");
    expect(executeToolMock).toHaveBeenCalledOnce();
  });

  it("keeps a teammate's turn from briefing a Coworker after reading the web", async () => {
    findFirstEventMock.mockResolvedValue({ id: "taint" });
    turnFindUniqueMock.mockResolvedValue({
      source: "CHAT",
      parentTurnId: null,
      askedByUserId: "teammate",
      chainDepth: 0,
      chatMentionId: "mention",
    });
    await expect(
      runSandboxTool(claims, {
        capability: "assign_task",
        toolCallId: "c9",
        toolInput: {},
      }),
    ).rejects.toThrow("ask the owner in chat");
    expect(executeToolMock).not.toHaveBeenCalled();
  });
});
