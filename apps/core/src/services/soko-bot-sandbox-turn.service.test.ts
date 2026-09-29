import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authorizeMock,
  createEventMock,
  executeToolMock,
  findFirstEventMock,
  fetchMock,
  toolCallUpsertMock,
  toolCallUpdateManyMock,
} = vi.hoisted(() => ({
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
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotRuntimeEvent: {
      create: createEventMock,
      findFirst: findFirstEventMock,
    },
    sokoBotTurn: { findUnique: vi.fn().mockResolvedValue(null) },
    sokoBotToolCall: {
      upsert: toolCallUpsertMock,
      updateMany: toolCallUpdateManyMock,
    },
  },
}));
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
      "ai-language-model-streaming": "false",
      "ai-language-model-specification-version": "4",
      ...overrides,
    }),
    body: JSON.stringify({
      prompt: [],
      providerOptions: { gateway: { only: ["openai"] } },
    }),
  };
}

function gatewayAnswer(content: unknown[] = []) {
  return new Response(
    JSON.stringify({
      content,
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
    }),
    { status: 200 },
  );
}

describe("sandbox turn service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    findFirstEventMock.mockResolvedValue(null);
    createEventMock.mockResolvedValue({});
    authorizeMock.mockResolvedValue({
      turn: { id: claims.turnId, versionId: "v16" },
      grant: { capabilities: ["web_fetch", "post_chat", "update_plan"] },
    });
  });

  it("refuses streaming and any model but the turn's", async () => {
    await expect(
      proxySandboxModelCall(
        claims,
        modelRequest({ "ai-language-model-streaming": "true" }),
      ),
    ).rejects.toThrow("Streaming");
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
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentHeaders = new Headers(init.headers);
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

  it("still meters a call whose region is rejected", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
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
        }),
        { status: 200 },
      ),
    );
    await expect(
      proxySandboxModelCall(claims, modelRequest()),
    ).rejects.toThrow();
    expect(events().map((event) => event.type)).toContain("step.completed");
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
      gatewayAnswer([{ type: "tool-result", toolName: "web_search" }]),
    );
    await proxySandboxModelCall(claims, modelRequest());
    expect(events().map((event) => event.type)).toContain(
      "sandbox.untrusted_input",
    );
  });

  it("marks the turn before a sandbox tool runs, but not for the plan", async () => {
    await recordSandboxAction(claims, {
      name: "update_plan",
      toolCallId: "c1",
      toolInput: { steps: [] },
    });
    expect(events().map((event) => event.type)).toEqual(["actions.requested"]);

    await recordSandboxAction(claims, {
      name: "web_fetch",
      toolCallId: "c2",
      toolInput: { url: "https://example.com" },
    });
    expect(events().map((event) => event.type)).toEqual([
      "actions.requested",
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

  it("refuses an outward action after the turn read the web", async () => {
    findFirstEventMock.mockResolvedValue({ id: "taint" });
    await expect(
      runSandboxTool(claims, {
        capability: "post_chat",
        toolCallId: "c5",
        toolInput: {},
      }),
    ).rejects.toThrow("request_user_decision");
    expect(executeToolMock).not.toHaveBeenCalled();
  });
});
