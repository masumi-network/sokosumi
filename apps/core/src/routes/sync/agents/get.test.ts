import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import mountSyncAgents from "./get";

const {
  captureExceptionMock,
  syncCardanoV2RailReadinessMock,
  syncRegistryAgentsMock,
  syncX402BuySideReadinessMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  syncCardanoV2RailReadinessMock: vi.fn(),
  syncRegistryAgentsMock: vi.fn(),
  syncX402BuySideReadinessMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@/services/agent-sync.service", () => ({
  agentSyncService: {
    syncCardanoV2RailReadiness: syncCardanoV2RailReadinessMock,
    syncRegistryAgents: syncRegistryAgentsMock,
  },
}));

vi.mock("@/services/agent-sync.x402-readiness", () => ({
  syncX402BuySideReadiness: syncX402BuySideReadinessMock,
}));

// Run the sync operation directly: the lock, cron auth, and deadline budget
// belong to handleSyncRequest's own tests, and this file is about what the
// operation does with a failing x402 readiness sync.
vi.mock("../handler.js", () => ({
  handleSyncRequest: async (
    c: { json: (body: unknown) => Response },
    _lockKey: string,
    operation: (context: {
      abortSignal: AbortSignal;
      deadlineMs: number;
      msRemaining: () => number;
      shouldContinue: () => boolean;
    }) => Promise<void>,
  ) => {
    await operation({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      msRemaining: () => 60_000,
      shouldContinue: () => true,
    });
    return c.json({ ok: true });
  },
}));

function createApp() {
  const app = new Hono();
  mountSyncAgents(app);
  return app;
}

describe("GET /sync/agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    syncCardanoV2RailReadinessMock.mockResolvedValue(false);
    syncX402BuySideReadinessMock.mockResolvedValue(false);
    syncRegistryAgentsMock.mockResolvedValue(undefined);
  });

  it("reports a thrown x402 readiness sync to Sentry and still syncs the registry", async () => {
    // syncX402BuySideReadiness alerts on its OWN handled failures. A throw
    // escapes that path entirely, so without a report here the stale cache
    // keeps serving "ready" behind nothing louder than a console line.
    const abortError = new Error("The operation was aborted");
    syncX402BuySideReadinessMock.mockRejectedValue(abortError);
    const app = createApp();

    const response = await app.request("http://localhost/agents");

    expect(response.status).toBe(200);
    expect(captureExceptionMock).toHaveBeenCalledWith(abortError, {
      tags: { x402_readiness: "sync_threw" },
    });
    // Isolation is the point of the catch: the registry sync still runs.
    expect(syncRegistryAgentsMock).toHaveBeenCalledTimes(1);
  });

  it("reports nothing when the x402 readiness sync returns normally", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/agents");

    expect(response.status).toBe(200);
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(syncRegistryAgentsMock).toHaveBeenCalledTimes(1);
  });

  it("resets the registry cursor only when Cardano readiness changed", async () => {
    syncCardanoV2RailReadinessMock.mockResolvedValue(true);
    const app = createApp();

    await app.request("http://localhost/agents");

    expect(syncRegistryAgentsMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ resetCursor: true }),
    );
  });

  it("resets the registry cursor when an authenticated caller requests replay", async () => {
    const app = createApp();

    await app.request("http://localhost/agents?replay=true");

    expect(syncRegistryAgentsMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ resetCursor: true }),
    );
  });

  it("keeps non-true replay values incremental", async () => {
    const app = createApp();

    await app.request("http://localhost/agents?replay=false");

    expect(syncRegistryAgentsMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.objectContaining({ resetCursor: true }),
    );
  });
});
