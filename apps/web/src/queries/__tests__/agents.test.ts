import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnAuthenticatedError } from "@/lib/auth/errors";
import { getAgentInputSchemaQueryOptions } from "@/queries/agents";

const { MockCoreApiRequestError, getAgentInputSchemaMock } = vi.hoisted(() => {
  class MockCoreApiRequestError extends Error {
    status?: number;

    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options?.status;
    }
  }

  return {
    MockCoreApiRequestError,
    getAgentInputSchemaMock: vi.fn(),
  };
});

vi.mock("@/lib/clients/core.browser.client", () => ({
  CoreApiRequestError: MockCoreApiRequestError,
  coreClient: {
    getAgentInputSchema: (...args: unknown[]) =>
      getAgentInputSchemaMock(...args),
  },
}));

describe("getAgentInputSchemaQueryOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the agent input schema through the browser core client", async () => {
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

  it("preserves text and textarea defaults from the raw schema response", async () => {
    getAgentInputSchemaMock.mockResolvedValue({
      data: {
        input_data: [
          {
            id: "language",
            name: "Campaign Language",
            type: "text",
            data: {
              default: "English",
            },
          },
          {
            id: "goal",
            name: "Primary Campaign Goal",
            type: "textarea",
            data: {
              default: "Generate leads and increase brand awareness",
            },
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
          id: "language",
          name: "Campaign Language",
          type: "text",
          data: {
            default: "English",
            description: undefined,
            placeholder: undefined,
          },
          validations: undefined,
        },
        {
          id: "goal",
          name: "Primary Campaign Goal",
          type: "textarea",
          data: {
            default: "Generate leads and increase brand awareness",
            description: undefined,
            placeholder: undefined,
          },
          validations: undefined,
        },
      ],
    });
  });

  it("maps 401 responses to UnAuthenticatedError", async () => {
    getAgentInputSchemaMock.mockRejectedValue(
      new MockCoreApiRequestError("Please sign in", { status: 401 }),
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
    getAgentInputSchemaMock.mockRejectedValue(new Error("boom"));

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
