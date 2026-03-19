import { UnAuthenticatedError } from "@/lib/auth/errors";
import { getAgentInputSchemaQueryOptions } from "@/queries/agents";

describe("getAgentInputSchemaQueryOptions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fetches the internal agent input schema route with credentials included", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          input_data: [
            {
              id: "prompt",
              name: "Prompt",
              type: "string",
            },
          ],
        },
        timestamp: new Date("2026-03-20T12:00:00.000Z").toISOString(),
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const options = getAgentInputSchemaQueryOptions("agent-1");
    const queryFn = options.queryFn;

    if (!queryFn) {
      throw new Error("queryFn is required");
    }

    await expect(queryFn({} as never)).resolves.toEqual({
      input_data: [
        {
          id: "prompt",
          name: "Prompt",
          type: "string",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/internal/agents/agent-1/input-schema",
      {
        credentials: "include",
      },
    );
  });

  it("maps 401 responses to UnAuthenticatedError", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const options = getAgentInputSchemaQueryOptions("agent-1");
    const queryFn = options.queryFn;

    if (!queryFn) {
      throw new Error("queryFn is required");
    }

    await expect(queryFn({} as never)).rejects.toBeInstanceOf(
      UnAuthenticatedError,
    );
  });

  it("preserves non-auth failures as generic errors", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const options = getAgentInputSchemaQueryOptions("agent-1");
    const queryFn = options.queryFn;

    if (!queryFn) {
      throw new Error("queryFn is required");
    }

    await expect(queryFn({} as never)).rejects.toThrow(
      "Failed to fetch agent input schema",
    );
  });
});
