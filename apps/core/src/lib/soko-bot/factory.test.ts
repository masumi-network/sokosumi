import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getEnvMock } = vi.hoisted(() => ({ getEnvMock: vi.fn() }));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/lib/soko-bot/eve-http-runtime", () => ({
  EveHttpSokoBotRuntime: class EveHttpSokoBotRuntime {},
}));
vi.mock("@/lib/soko-bot/in-memory-runtime", () => ({
  InMemorySokoBotRuntime: class InMemorySokoBotRuntime {},
}));

const originalNodeEnv = process.env.NODE_ENV;

describe("getSokoBotRuntime", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("fails closed when production enables Soko Bot with the in-memory adapter", async () => {
    process.env.NODE_ENV = "production";
    getEnvMock.mockReturnValue({
      SOKO_BOT_ENABLED: true,
      SOKO_BOT_RUNTIME_ADAPTER: "in-memory",
    });
    const { getSokoBotRuntime } = await import("./factory");

    expect(() => getSokoBotRuntime()).toThrow(
      "SOKO_BOT_RUNTIME_ADAPTER must be eve when Soko Bot is enabled in production",
    );
  });

  it("keeps the in-memory adapter available for disabled production control planes", async () => {
    process.env.NODE_ENV = "production";
    getEnvMock.mockReturnValue({
      SOKO_BOT_ENABLED: false,
      SOKO_BOT_RUNTIME_ADAPTER: "in-memory",
    });
    const { getSokoBotRuntime } = await import("./factory");

    expect(getSokoBotRuntime()).toBeDefined();
  });
});
