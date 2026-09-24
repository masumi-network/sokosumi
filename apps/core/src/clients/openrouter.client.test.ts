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
    generateTextMock.mockResolvedValue({ text: "Launch page teardown" });
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
      expect.stringContaining("Plain text without markdown"),
    );
  });

  it("returns null when the agent description is too thin to summarise", async () => {
    generateTextMock.mockResolvedValue({ text: "NONE\n" });

    const { openrouterClient } = await import("./openrouter.client");

    await expect(
      openrouterClient.generateAgentSummary("test"),
    ).resolves.toBeNull();
  });

  it("returns the generated agent summary", async () => {
    generateTextMock.mockResolvedValue({
      text: "Analyzes competitor landing pages and reports conversion gaps for marketing teams",
    });

    const { openrouterClient } = await import("./openrouter.client");

    await expect(
      openrouterClient.generateAgentSummary("Landing page teardown agent"),
    ).resolves.toBe(
      "Analyzes competitor landing pages and reports conversion gaps for marketing teams",
    );
  });

  it("returns null when generateText throws trailing bytes", async () => {
    generateTextMock.mockRejectedValue(new Error("479 trailing bytes"));
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      const { openrouterClient } = await import("./openrouter.client");

      await expect(
        openrouterClient.generateTaskName("Build landing page"),
      ).resolves.toBeNull();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("returns null without calling generateText when OpenRouter is not configured", async () => {
    getEnvMock.mockReturnValue({});

    const { openrouterClient } = await import("./openrouter.client");

    await expect(
      openrouterClient.generateTaskName("hello"),
    ).resolves.toBeNull();
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(createOpenRouterMock).not.toHaveBeenCalled();
  });
});
