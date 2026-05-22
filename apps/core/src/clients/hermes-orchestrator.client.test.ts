import { beforeEach, describe, expect, it, vi } from "vitest";

import { hermesInstanceSchema } from "@/schemas/hermes.schema";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

describe("hermes-orchestrator.client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("coerces invalid integration connectedAt to null so instance schema parse succeeds", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        status: "ready",
        endpointUrl: null,
        integrations: [
          {
            provider: "gmail",
            status: "connected",
            connectedAt: "not-a-valid-iso-datetime",
            mode: "read",
          },
        ],
      }),
    });

    const { getInstance } = await import("./hermes-orchestrator.client");
    const instance = await getInstance("user_123");

    expect(instance).not.toBeNull();
    expect(instance?.integrations).toEqual([
      {
        provider: "gmail",
        status: "connected",
        connectedAt: null,
        mode: "read",
      },
    ]);

    expect(() => hermesInstanceSchema.parse(instance)).not.toThrow();
  });

  it("preserves valid integration connectedAt", async () => {
    const connectedAt = "2024-06-01T12:00:00.000Z";
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        status: "ready",
        endpointUrl: null,
        integrations: [
          {
            provider: "gmail",
            status: "connected",
            connectedAt,
            mode: "write",
          },
        ],
      }),
    });

    const { getInstance } = await import("./hermes-orchestrator.client");
    const instance = await getInstance("user_456");

    expect(instance?.integrations[0]?.connectedAt).toBe(connectedAt);
    expect(() => hermesInstanceSchema.parse(instance)).not.toThrow();
  });

  it("coerces invalid onboardedAt to null so instance schema parse succeeds", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        status: "ready",
        endpointUrl: null,
        onboardedAt: "not-a-valid-iso-datetime",
        welcomeMessage: "Welcome back.",
        welcomeKind: "returning",
      }),
    });

    const { getInstance } = await import("./hermes-orchestrator.client");
    const instance = await getInstance("user_789");

    expect(instance?.onboardedAt).toBeNull();
    expect(instance?.welcomeMessage).toBe("Welcome back.");
    expect(() => hermesInstanceSchema.parse(instance)).not.toThrow();
  });
});
