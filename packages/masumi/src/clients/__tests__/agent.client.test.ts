import { createAgentClient } from "../agent.client.js";
import type { Agent } from "../../types/agent.js";

function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Test Agent",
    blockchainIdentifier: "blockchain-agent-1",
    apiBaseUrl: "https://agent.example.com",
    overrideApiBaseUrl: null,
    ...overrides,
  };
}

describe("createAgentClient URL validation", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("does not block localhost hostnames anymore", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAgentClient();
    const result = await client.startFreeAgentJob(
      createAgent({ apiBaseUrl: "http://localhost:3000" }),
      { prompt: "hello" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://localhost:3000/start_job",
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe("Failed to start free agent job");
    }
  });

  it("rejects API base URLs with query strings", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAgentClient();
    const result = await client.startFreeAgentJob(
      createAgent({ apiBaseUrl: "https://agent.example.com?token=abc" }),
      { prompt: "hello" },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain(
        "Agent API base URL must not have a query string",
      );
    }
  });

  it("rejects API base URLs with hashes", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAgentClient();
    const result = await client.startFreeAgentJob(
      createAgent({ apiBaseUrl: "https://agent.example.com#fragment" }),
      { prompt: "hello" },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain("Agent API base URL must not have a hash");
    }
  });

  it("rejects non-http/https API base URLs", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAgentClient();
    const result = await client.startFreeAgentJob(
      createAgent({ apiBaseUrl: "ftp://agent.example.com" }),
      { prompt: "hello" },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain("Agent API base URL must be HTTP or HTTPS");
    }
  });
});
