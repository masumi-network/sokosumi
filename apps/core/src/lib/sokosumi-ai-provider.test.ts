import { beforeEach, describe, expect, it, vi } from "vitest";

const { getEnvMock, getBetterAuthPublicBaseUrlMock, createSokosumiMock } =
  vi.hoisted(() => ({
    getEnvMock: vi.fn(),
    getBetterAuthPublicBaseUrlMock: vi.fn(() => "https://core.example"),
    createSokosumiMock: vi.fn((options: unknown) => options),
  }));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
  getBetterAuthPublicBaseUrl: getBetterAuthPublicBaseUrlMock,
}));

vi.mock("@sokosumi/ai-provider", () => ({
  createSokosumi: createSokosumiMock,
}));

describe("getOpenRouterChatApiKeyForProvider", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("reads OPENROUTER_CHAT_API_KEY through getEnv", async () => {
    getEnvMock.mockReturnValue({
      OPENROUTER_CHAT_API_KEY: "sk-or-v1-chat-key",
    });
    const { getOpenRouterChatApiKeyForProvider } = await import(
      "./sokosumi-ai-provider"
    );
    expect(getOpenRouterChatApiKeyForProvider()).toBe("sk-or-v1-chat-key");
  });

  it("returns an empty string when the chat key is unset", async () => {
    getEnvMock.mockReturnValue({});
    const { getOpenRouterChatApiKeyForProvider } = await import(
      "./sokosumi-ai-provider"
    );
    expect(getOpenRouterChatApiKeyForProvider()).toBe("");
  });
});

describe("getSokosumiProvider", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getBetterAuthPublicBaseUrlMock.mockReturnValue("https://core.example");
  });

  it("passes the getEnv chat key into createSokosumi", async () => {
    getEnvMock.mockReturnValue({
      OPENROUTER_CHAT_API_KEY: "sk-or-v1-chat-key",
    });
    const { getSokosumiProvider } = await import("./sokosumi-ai-provider");

    getSokosumiProvider();

    expect(createSokosumiMock).toHaveBeenCalledWith({
      openRouterApiKey: "sk-or-v1-chat-key",
      openRouterHttpReferer: "https://core.example",
      openRouterAppTitle: "Sokosumi",
    });
  });
});
