import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

const getAgentsByIdInputSchemaMock = vi.fn();
const postUsersByIdFilesMock = vi.fn();
const createClientMock = vi.fn();
const mockClient = {
  id: "browser-core-client",
} as never;

vi.mock("@/lib/clients/utils/core-api-base-url.browser", () => ({
  getBrowserCoreApiBaseUrl: () => "https://api.sokosumi.com/v1",
}));

vi.mock("@/lib/clients/generated/core/client", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/clients/generated/core", () => ({
  getAgentsByIdInputSchema: getAgentsByIdInputSchemaMock,
  postUsersByIdFiles: (...args: unknown[]) => postUsersByIdFilesMock(...args),
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

    const { coreClient } = await import("./core.browser.client");
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
    const { CoreApiRequestError, toCoreApiActionError } = await import(
      "./core.browser.client"
    );
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

  it("creates direct upload sessions through the browser transport", async () => {
    postUsersByIdFilesMock.mockResolvedValue({
      data: {
        data: {
          uploadUrl: "https://blob.example/upload?sig=1",
          access: "public",
          method: "PUT",
          headers: { "Content-Type": "application/pdf" },
          pathname: "users/user_123/report.pdf",
          addRandomSuffix: true,
          maxSizeBytes: 1073741824,
          expiresAt: "2026-07-30T12:15:00.000Z",
        },
        meta: {
          timestamp: new Date("2026-04-02T12:00:00.000Z"),
          requestId: "req_upload",
        },
      },
      response: new Response("{}", { status: 201 }),
    });

    const { coreClient } = await import("./core.browser.client");
    const response = await coreClient.createMyFileUploadSession({
      filename: "report.pdf",
      contentType: "application/pdf",
      size: 1234,
    });

    expect(postUsersByIdFilesMock).toHaveBeenCalledWith({
      client: mockClient,
      path: { id: "me" },
      body: {
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 1234,
      },
      cache: "no-store",
    });
    expect(response.data.pathname).toBe("users/user_123/report.pdf");
  });

  it("forwards optional upload constraints to the browser transport", async () => {
    postUsersByIdFilesMock.mockResolvedValue({
      data: {
        data: {
          uploadUrl: "https://blob.example/upload?sig=logo",
          access: "public",
          method: "PUT",
          headers: { "Content-Type": "image/png" },
          pathname: "users/user_123/logo.png",
          addRandomSuffix: true,
          maxSizeBytes: 2097152,
          expiresAt: "2026-07-30T12:15:00.000Z",
        },
        meta: {
          timestamp: new Date("2026-04-02T12:00:00.000Z"),
          requestId: "req_upload",
        },
      },
      response: new Response("{}", { status: 201 }),
    });

    const { coreClient } = await import("./core.browser.client");
    await coreClient.createMyFileUploadSession({
      filename: "logo.png",
      contentType: "image/png",
      size: 1024,
      maxSizeBytes: 2097152,
      allowedContentTypes: ["image/png", "image/jpeg"],
    });

    expect(postUsersByIdFilesMock).toHaveBeenCalledWith({
      client: mockClient,
      path: { id: "me" },
      body: {
        filename: "logo.png",
        contentType: "image/png",
        size: 1024,
        maxSizeBytes: 2097152,
        allowedContentTypes: ["image/png", "image/jpeg"],
      },
      cache: "no-store",
    });
  });
});
