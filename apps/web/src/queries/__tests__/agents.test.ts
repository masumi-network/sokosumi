import { UnAuthenticatedError } from "@/lib/auth/errors";
import { getAgentInputSchemaQueryOptions } from "@/queries/agents";

const getAgentInputSchemaMock = jest.fn();

jest.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class CoreApiRequestError extends Error {
    status?: number;

    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options?.status;
    }
  },
  coreClient: {
    getAgentInputSchema: (...args: unknown[]) => getAgentInputSchemaMock(...args),
  },
}));

const { CoreApiRequestError } = jest.requireMock("@/lib/clients/core.client") as {
  CoreApiRequestError: new (
    message: string,
    options?: { status?: number },
  ) => Error;
};

describe("getAgentInputSchemaQueryOptions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the agent input schema through coreClient", async () => {
    getAgentInputSchemaMock.mockResolvedValue({
      data: {
        input_data: [
          {
            id: "prompt",
            name: "Prompt",
            type: "string",
          },
        ],
      },
    });

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
    expect(getAgentInputSchemaMock).toHaveBeenCalledWith("agent-1");
  });

  it("maps 401 responses to UnAuthenticatedError", async () => {
    getAgentInputSchemaMock.mockRejectedValue(
      new CoreApiRequestError("Unauthorized", { status: 401 }),
    );

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
    getAgentInputSchemaMock.mockRejectedValue(
      new CoreApiRequestError("Input schema missing", { status: 404 }),
    );

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
