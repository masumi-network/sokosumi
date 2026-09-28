import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getEnvMock } = vi.hoisted(() => ({ getEnvMock: vi.fn() }));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/lib/soko-bot/in-process-runtime", () => ({
  InProcessSokoBotRuntime: class InProcessSokoBotRuntime {},
}));
vi.mock("@/lib/soko-bot/in-memory-runtime", () => ({
  InMemorySokoBotRuntime: class InMemorySokoBotRuntime {},
}));
vi.mock("@/lib/soko-bot/sandbox/sandbox-runtime", () => ({
  SandboxSokoBotRuntime: class SandboxSokoBotRuntime {},
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
      "SOKO_BOT_RUNTIME_ADAPTER must be sandbox or in-process when Soko Bot is enabled in a deployed environment",
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

  it("runs turns in the sandbox by default", async () => {
    getEnvMock.mockReturnValue({
      SOKO_BOT_ENABLED: true,
      SOKO_BOT_RUNTIME_ADAPTER: "sandbox",
    });
    const { getSokoBotRuntime } = await import("./factory");

    expect(getSokoBotRuntime().constructor.name).toBe("SandboxSokoBotRuntime");
  });

  it("keeps preview evaluation runs in Core, where the ledger meters them", async () => {
    getEnvMock.mockReturnValue({
      SOKO_BOT_ENABLED: true,
      SOKO_BOT_RUNTIME_ADAPTER: "sandbox",
      SOKO_BOT_EVALUATION_ALLOWANCE: "{}",
    });
    const { getSokoBotRuntime } = await import("./factory");

    expect(getSokoBotRuntime().constructor.name).toBe(
      "InProcessSokoBotRuntime",
    );
  });
});
