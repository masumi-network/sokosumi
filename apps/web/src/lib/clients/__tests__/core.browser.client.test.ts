import { beforeEach, describe, expect, it, vi } from "vitest";
export {};

const getAgentsByIdInputSchemaMock = vi.fn();
const createClientMock = vi.fn();
const mockClient = { id: "browser-core-client" } as never;

vi.mock("@/lib/clients/utils/core-api-base-url.browser", () => ({
  getBrowserCoreApiBaseUrl: () => "https://api.sokosumi.com/v1",
}));

vi.mock("@/lib/clients/generated/core/client", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/clients/generated/core", () => ({
  getAgentsByIdInputSchema: getAgentsByIdInputSchemaMock,
}));

describe("core.browser.client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    createClientMock.mockReturnValue(mockClient);
  });

  it("executes generated operations through the browser transport", async () => {
    getAgentsByIdInputSchemaMock.mockResolvedValue({
      data: {
        data: {
          input_data: [
            {
              id: "prompt",
              name: "Prompt",
              type: "string",
            },
          ],
        },
      },
      response: new Response("{}", { status: 200 }),
    });

    const { coreClient } = await import("../core.browser.client");
    const response = await coreClient.getAgentInputSchema("agent_1");

    expect(createClientMock).toHaveBeenCalledWith({
      baseUrl: "https://api.sokosumi.com/v1",
      credentials: "include",
    });
    expect(getAgentsByIdInputSchemaMock).toHaveBeenCalledWith({
      client: mockClient,
      path: { id: "agent_1" },
    });
    expect("input_data" in response.data).toBe(true);
  });

  it("re-exports shared action error mapping", async () => {
    const { CoreApiRequestError, toCoreApiActionError } =
      await import("../core.browser.client");
    const { CommonErrorCode } = await import("@/lib/actions/errors");

    expect(
      toCoreApiActionError(
        new CoreApiRequestError("Core backend timeout", { status: 503 }),
      ),
    ).toEqual({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: "The service is currently unavailable.",
    });
  });
});
