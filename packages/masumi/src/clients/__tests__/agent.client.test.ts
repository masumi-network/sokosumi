import { hashCanonicalJsonValue, hashInputSchema } from "../../hash/hash.js";
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
    const inputSchema = JSON.stringify({
      input_data: [
        {
          id: "answer",
          name: "Answer",
          type: "string",
        },
      ],
    });

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

  it("accepts bare-array input schema for backward compatibility", async () => {
    const bareSchema = JSON.stringify([
      { id: "answer", name: "Answer", type: "string" },
    ]);
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          input_hash: "hash-123",
          signature: "sig-456",
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
      "job-1",
      bareSchema,
      { answer: "8" },
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        input_hash: "hash-123",
        signature: "sig-456",
      });
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestOptions.method).toBe("POST");
    expect(JSON.parse(String(requestOptions.body))).toEqual({
      job_id: "job-1",
      input_schema_hash: hashInputSchema(bareSchema),
      input_data: {
        answer: "8",
      },
    });
  });
});

describe("createAgentClient fetchAgentJobStatus", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("returns statusHash from canonical parsed status payload", async () => {
    const responseBody = {
      status: "awaiting_input",
      input_schema: {
        input_data: [
          {
            id: "prompt",
            name: "Prompt",
            type: "string",
          },
        ],
      },
      result: null,
    };
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAgentClient();
    const result = await client.fetchAgentJobStatus(createAgent(), "job-1");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.status).toBe("awaiting_input");
      expect(result.value.statusHash).toBe(
        hashCanonicalJsonValue(responseBody),
      );
    }
  });

  it("ignores unknown fields when deriving statusHash", async () => {
    const baseResponseBody = {
      status: "running",
      input_schema: null,
      result: null,
    };
    const firstResponseBody = {
      ...baseResponseBody,
      id: "legacy-status-id",
      timestamp: "2026-03-02T10:00:00.000Z",
    };
    const secondResponseBody = {
      ...baseResponseBody,
      id: "another-id",
      timestamp: "2026-03-02T10:05:00.000Z",
      trace_id: "trace-123",
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(firstResponseBody), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(secondResponseBody), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAgentClient();
    const firstResult = await client.fetchAgentJobStatus(
      createAgent(),
      "job-1",
    );
    const secondResult = await client.fetchAgentJobStatus(
      createAgent(),
      "job-1",
    );

    expect(firstResult.isOk()).toBe(true);
    expect(secondResult.isOk()).toBe(true);
    if (firstResult.isOk() && secondResult.isOk()) {
      expect(firstResult.value.statusHash).toBe(secondResult.value.statusHash);
      expect(firstResult.value.statusHash).toBe(
        hashCanonicalJsonValue(baseResponseBody),
      );
    }
  });

  it("forwards an abort signal to the status fetch request", async () => {
    const responseBody = {
      status: "running",
      input_schema: null,
      result: null,
    };
    const abortSignal = AbortSignal.timeout(1000);
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAgentClient();
    const result = await client.fetchAgentJobStatus(createAgent(), "job-1", {
      signal: abortSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "GET",
        signal: abortSignal,
      }),
    );
  });
});
