import { hashInputSchema } from "../../hash/hash.js";
import type { Agent } from "../../types/agent.js";
import { createAgentClient } from "../agent.client.js";

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

  it("blocks localhost hostnames to prevent SSRF", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAgentClient();
    const result = await client.startFreeAgentJob(
      createAgent({ apiBaseUrl: "http://localhost:3000" }),
      { prompt: "hello" },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain(
        "Agent API base URL must not point to internal or private addresses",
      );
    }
  });

  it("blocks 127.0.0.1 to prevent SSRF", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAgentClient();
    const result = await client.startFreeAgentJob(
      createAgent({ apiBaseUrl: "http://127.0.0.1:3000" }),
      { prompt: "hello" },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain(
        "Agent API base URL must not point to internal or private addresses",
      );
    }
  });

  it("blocks private IP ranges to prevent SSRF", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAgentClient();

    const privateIPs = [
      "http://10.0.0.1",
      "http://172.16.0.1",
      "http://192.168.1.1",
    ];

    for (const ip of privateIPs) {
      const result = await client.startFreeAgentJob(
        createAgent({ apiBaseUrl: ip }),
        { prompt: "hello" },
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toContain(
          "Agent API base URL must not point to internal or private addresses",
        );
      }
      fetchMock.mockClear();
    }
  });

  it("blocks cloud metadata endpoints (169.254.x.x) to prevent SSRF", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAgentClient();
    const result = await client.startFreeAgentJob(
      createAgent({ apiBaseUrl: "http://169.254.169.254/latest/meta-data/" }),
      { prompt: "hello" },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain(
        "Agent API base URL must not point to internal or private addresses",
      );
    }
  });

  it("blocks override URLs with internal addresses", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAgentClient();
    const result = await client.startFreeAgentJob(
      createAgent({
        apiBaseUrl: "https://agent.example.com",
        overrideApiBaseUrl: "http://localhost:3000",
      }),
      { prompt: "hello" },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain(
        "Agent API base URL override must not point to internal or private addresses",
      );
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
      expect(result.error).toContain(
        "Agent API base URL must be HTTP or HTTPS",
      );
    }
  });
});

describe("createAgentClient provideJobInput", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("sends input_schema_hash in the provide_input request body", async () => {
    const inputSchema = JSON.stringify([
      {
        id: "answer",
        name: "Answer",
        type: "string",
      },
    ]);

    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          input_hash: "input-hash",
          signature: "signature",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAgentClient();
    const result = await client.provideJobInput(
      createAgent(),
      "status-1",
      "job-1",
      inputSchema,
      {
        answer: "8",
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [requestUrl, requestOptions] = fetchMock.mock.calls[0] as [
      RequestInfo | URL,
      RequestInit,
    ];
    expect(String(requestUrl)).toBe("https://agent.example.com/provide_input");
    expect(requestOptions.method).toBe("POST");
    expect(JSON.parse(String(requestOptions.body))).toEqual({
      job_id: "job-1",
      status_id: "status-1",
      input_schema_hash: hashInputSchema(inputSchema),
      input_data: {
        answer: "8",
      },
    });
  });

  it("returns error and skips request when input schema hashing fails", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAgentClient();
    const result = await client.provideJobInput(
      createAgent(),
      "status-1",
      "job-1",
      "not-json",
      {
        answer: "8",
      },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe("Failed to hash input schema");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
