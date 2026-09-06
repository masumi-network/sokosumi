import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generateTextMock,
  openRouterModelMock,
  createOpenRouterMock,
  getEnvMock,
} = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  openRouterModelMock: vi.fn(),
  createOpenRouterMock: vi.fn(),
  getEnvMock: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: generateTextMock,
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: createOpenRouterMock,
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

describe("openrouter.client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    openRouterModelMock.mockReturnValue("mock-haiku-model");
    createOpenRouterMock.mockReturnValue(openRouterModelMock);
    getEnvMock.mockReturnValue({
      OPENROUTER_DEFAULT_API_KEY: "sk-or-test-openrouter-key",
    });
    generateTextMock.mockResolvedValue({ text: "Generated chat title" });
  });

  it("calls generateText with instructions (not deprecated system) for chat titles", async () => {
    const { openrouterClient } = await import("./openrouter.client");

    const title = await openrouterClient.generateChatTitle("  Hello world  ");

    expect(title).toBe("Generated chat title");
    expect(createOpenRouterMock).toHaveBeenCalledWith({
      apiKey: "sk-or-test-openrouter-key",
    });
    expect(openRouterModelMock).toHaveBeenCalledWith(
      "anthropic/claude-haiku-4.5",
    );
    expect(generateTextMock).toHaveBeenCalledOnce();

    const call = generateTextMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.instructions).toEqual(
      expect.stringContaining("Generate a very short chat title"),
    );
    expect(call.prompt).toBe("First message: Hello world");
    expect(call.temperature).toBe(0.5);
    expect(call.maxOutputTokens).toBe(40);
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
    expect(call.model).toBe("mock-haiku-model");
    expect(call).not.toHaveProperty("system");
  });

  it("truncates generated chat titles to 50 characters", async () => {
    generateTextMock.mockResolvedValue({ text: "A".repeat(60) });

    const { openrouterClient } = await import("./openrouter.client");

    const title = await openrouterClient.generateChatTitle("hello");

    expect(title).toBe("A".repeat(50));
    expect(generateTextMock).toHaveBeenCalledOnce();
  });

  it("caps task description length and asks for a plain-language name", async () => {
    generateTextMock.mockResolvedValue({ text: "Launch page teardown" });

    const { openrouterClient } = await import("./openrouter.client");

    const name = await openrouterClient.generateTaskName(
      `${"A".repeat(1200)}\n# Heading dump`,
    );

    expect(name).toBe("Launch page teardown");
    const call = generateTextMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.prompt).toBe(`Task Description: ${"A".repeat(1000)}`);
    expect(call.temperature).toBe(0.5);
    expect(call.instructions).toEqual(
      expect.stringContaining("Do NOT: use markdown"),
    );
  });

  it("returns null without calling generateText when OpenRouter is not configured", async () => {
    getEnvMock.mockReturnValue({});

    const { openrouterClient } = await import("./openrouter.client");

    await expect(
      openrouterClient.generateChatTitle("hello"),
    ).resolves.toBeNull();
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(createOpenRouterMock).not.toHaveBeenCalled();
  });
});
