import { beforeEach, describe, expect, it, vi } from "vitest";

const { ssrfSafeFetchMock } = vi.hoisted(() => ({
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@sokosumi/net", () => ({
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

import { hashCanonicalJsonValue, hashInputSchema } from "../hash/hash.js";
import type { Agent } from "../types/agent.js";
import { createAgentClient } from "./agent.client.js";

function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Test Agent",
    blockchainIdentifier: "blockchain-agent-1",
    apiBaseUrl: "https://agent.example.com",
    metadataOverride: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startPaidAgentJob failure classification", () => {
  const inputData = { prompt: "hello" };

  function jsonResponse(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  }

  it("classifies a 5xx as ambiguous because seller acceptance is unknown", async () => {
    ssrfSafeFetchMock.mockResolvedValue(jsonResponse(503, {}));

    const result = await createAgentClient().startPaidAgentJob(
      createAgent(),
      "nonce",
      inputData,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("ambiguous");
      expect(result.error.message).toContain("status 503");
    }
  });

  it("classifies an explicit 4xx rejection as unreachable", async () => {
    ssrfSafeFetchMock.mockResolvedValue(jsonResponse(400, {}));

    const result = await createAgentClient().startPaidAgentJob(
      createAgent(),
      "nonce",
      inputData,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("unreachable");
      expect(result.error.message).toContain("status 400");
    }
  });

  it.each([302, 307] as const)(
    "classifies POST redirect %s as ambiguous — seller acceptance unknown",
    async (status: 302 | 307) => {
      ssrfSafeFetchMock.mockResolvedValue(
        new Response(null, {
          status,
          headers: { Location: "https://other.example/start_job" },
        }),
      );

      const result = await createAgentClient().startPaidAgentJob(
        createAgent(),
        "nonce",
        inputData,
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe("ambiguous");
        expect(result.error.message).toContain(`status ${status}`);
      }
    },
  );

  it("classifies an off-contract 2xx body as invalid-response — the job is stranded", async () => {
    // The exact shape a non-compliant seller returned on preprod: a 200 with
    // identifier_from_seller and none of agentIdentifier, sellerVKey,
    // identifierFromPurchaser, unlockTime or externalDisputeUnlockTime.
    ssrfSafeFetchMock.mockResolvedValue(
      jsonResponse(200, {
        job_id: "e76339ba-5fe3-49aa-912b-3543eb6f25cc",
        identifier_from_seller: "e76339ba-5fe3-49aa-912b-3543eb6f25cc",
        blockchainIdentifier: "1182",
        payByTime: "1785388352000",
        submitResultTime: "1785431552000",
        input_hash: "7b267b58",
        status: "awaiting_payment",
      }),
    );

    const result = await createAgentClient().startPaidAgentJob(
      createAgent(),
      "nonce",
      inputData,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("invalid-response");
      expect(result.error.message).toContain(
        "Failed to parse start job response",
      );
    }
  });

  it("classifies a 2xx with an unreadable body as invalid-response", async () => {
    ssrfSafeFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });

    const result = await createAgentClient().startPaidAgentJob(
      createAgent(),
      "nonce",
      inputData,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("invalid-response");
    }
  });

  it("classifies a transport error after dispatch as ambiguous", async () => {
    ssrfSafeFetchMock.mockRejectedValue(new Error("connection refused"));

    const result = await createAgentClient().startPaidAgentJob(
      createAgent(),
      "nonce",
      inputData,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("ambiguous");
    }
  });
});

describe("createAgentClient URL validation", () => {
  it("rejects API base URLs with query strings", async () => {
    const client = createAgentClient();
    const result = await client.startFreeAgentJob(
      createAgent({ apiBaseUrl: "https://agent.example.com?token=abc" }),
      { prompt: "hello" },
    );

    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      // A URL rejected before any request leaves: the seller never saw it, so
      // nothing is stranded.
      expect(result.error.kind).toBe("unreachable");
      expect(result.error.message).toContain(
        "Agent API base URL must not have a query string",
      );
    }
  });

  it("rejects API base URLs with hashes", async () => {
    const client = createAgentClient();
    const result = await client.startFreeAgentJob(
      createAgent({ apiBaseUrl: "https://agent.example.com#fragment" }),
      { prompt: "hello" },
    );

    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("unreachable");
      expect(result.error.message).toContain(
        "Agent API base URL must not have a hash",
      );
    }
  });

  it("rejects non-http/https API base URLs", async () => {
    const client = createAgentClient();
    const result = await client.startFreeAgentJob(
      createAgent({ apiBaseUrl: "ftp://agent.example.com" }),
      { prompt: "hello" },
    );

    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("unreachable");
      expect(result.error.message).toContain(
        "Agent API base URL must be HTTP or HTTPS",
      );
    }
  });

  it("defers private/internal-address blocking to connect time via ssrfSafeFetch", async () => {
    // Internal addresses are no longer rejected at URL-validation time; the
    // request reaches ssrfSafeFetch, which refuses the connection (covered by
    // @sokosumi/net's own tests). Here we assert the request is handed off.
    ssrfSafeFetchMock.mockRejectedValue(new Error("connection refused"));

    const client = createAgentClient();
    const result = await client.startFreeAgentJob(
      createAgent({ apiBaseUrl: "http://10.0.0.1" }),
      { prompt: "hello" },
    );

    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1);
    expect(String(ssrfSafeFetchMock.mock.calls[0]?.[0])).toBe(
      "http://10.0.0.1/start_job",
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("ambiguous");
    }
  });
});

describe("createAgentClient provideJobInput", () => {
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

    ssrfSafeFetchMock.mockResolvedValue(
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
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1);

    const [requestUrl, requestOptions] = ssrfSafeFetchMock.mock.calls[0] as [
      string | URL,
      { method?: string; body?: string },
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
      expect(result.error).toEqual({
        kind: "unreachable",
        message: "Failed to hash input schema",
      });
    }
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, "unreachable"],
    [408, "ambiguous"],
    [307, "ambiguous"],
    [503, "ambiguous"],
  ] as const)(
    "classifies HTTP %s as %s",
    async (status: number, expectedKind: "unreachable" | "ambiguous") => {
      ssrfSafeFetchMock.mockResolvedValue(
        new Response(null, {
          status,
          ...(status === 307
            ? { headers: { Location: "https://other.example/provide_input" } }
            : {}),
        }),
      );

      const result = await createAgentClient().provideJobInput(
        createAgent(),
        "job-1",
        JSON.stringify({ input_data: [] }),
        { answer: "8" },
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe(expectedKind);
        expect(result.error.message).toContain(`status ${status}`);
      }
    },
  );

  it("classifies transport failure after dispatch as ambiguous", async () => {
    ssrfSafeFetchMock.mockRejectedValue(new Error("response lost"));

    const result = await createAgentClient().provideJobInput(
      createAgent(),
      "job-1",
      JSON.stringify({ input_data: [] }),
      { answer: "8" },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe("ambiguous");
  });

  it.each([
    [
      "unreadable JSON",
      async () => Promise.reject(new SyntaxError("bad json")),
    ],
    ["off-contract body", async () => ({ accepted: true })],
  ])(
    "classifies 2xx %s as invalid-response",
    async (_label: string, json: () => Promise<unknown>) => {
      ssrfSafeFetchMock.mockResolvedValue({ ok: true, status: 200, json });

      const result = await createAgentClient().provideJobInput(
        createAgent(),
        "job-1",
        JSON.stringify({ input_data: [] }),
        { answer: "8" },
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.kind).toBe("invalid-response");
    },
  );

  it("accepts bare-array input schema for backward compatibility", async () => {
    const bareSchema = JSON.stringify([
      { id: "answer", name: "Answer", type: "string" },
    ]);
    ssrfSafeFetchMock.mockResolvedValue(
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

    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1);
    const [, requestOptions] = ssrfSafeFetchMock.mock.calls[0] as [
      string | URL,
      { method?: string; body?: string },
    ];
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
    ssrfSafeFetchMock.mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

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
    ssrfSafeFetchMock
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
    ssrfSafeFetchMock.mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    const client = createAgentClient();
    const result = await client.fetchAgentJobStatus(createAgent(), "job-1", {
      signal: abortSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "GET",
        signal: abortSignal,
      }),
    );
  });
});
