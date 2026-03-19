export {};

jest.mock("server-only", () => ({}));

const withRelatedProjectMock = jest.fn();
const getEnvPublicConfigMock = jest.fn();
const getCoreTransportAdapterMock = jest.fn();
const getConversationsMock = jest.fn();
const getAgentsByIdInputSchemaMock = jest.fn();
const getUsersMeNoticesPendingMock = jest.fn();
const postUsersMeNoticesByIdAcknowledgeMock = jest.fn();
const getUsersMeCreditsMock = jest.fn();
const getUsersMeOrganizationsMock = jest.fn();
const createGeneratedClientMock = jest.fn();
const mockClient = { id: "core-client" } as never;

jest.mock("@vercel/related-projects", () => ({
  withRelatedProject: (...args: unknown[]) => withRelatedProjectMock(...args),
}));

jest.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => getEnvPublicConfigMock(),
}));

jest.mock("../core.transport", () => ({
  getCoreTransportAdapter: () => getCoreTransportAdapterMock(),
}));

jest.mock("@/lib/clients/generated/core", () => ({
  getAgentsByIdInputSchema: getAgentsByIdInputSchemaMock,
  getConversations: getConversationsMock,
  getUsersMeNoticesPending: getUsersMeNoticesPendingMock,
  postUsersMeNoticesByIdAcknowledge: postUsersMeNoticesByIdAcknowledgeMock,
  getUsersMeCredits: getUsersMeCreditsMock,
  getUsersMeOrganizations: getUsersMeOrganizationsMock,
}));

describe("core.client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    getEnvPublicConfigMock.mockReturnValue({
      NEXT_PUBLIC_CORE_API_URL: "http://localhost:8787",
      NEXT_PUBLIC_NETWORK: "Mainnet",
    });
    withRelatedProjectMock.mockImplementation(
      ({ defaultHost }: { defaultHost: string }) => defaultHost,
    );

    createGeneratedClientMock.mockResolvedValue(mockClient);
    getCoreTransportAdapterMock.mockResolvedValue({
      createGeneratedClient: createGeneratedClientMock,
    });
  });

  it("builds auth headers from incoming request headers", async () => {
    const { buildAuthHeaders } = await import("../core.client");

    const authHeaders = buildAuthHeaders(
      new Headers({
        cookie: "session=value",
        "x-organization-slug": "org-slug",
      }),
    ) as Record<string, string>;

    expect(authHeaders).toEqual({
      cookie: "session=value",
    });
  });

  it("normalizes core API base urls with and without /v1", async () => {
    const { normalizeCoreApiBaseUrl } = await import("../core.client");

    expect(normalizeCoreApiBaseUrl("http://localhost:8787")).toBe(
      "http://localhost:8787/v1",
    );
    expect(normalizeCoreApiBaseUrl("http://localhost:8787/v1")).toBe(
      "http://localhost:8787/v1",
    );
    expect(normalizeCoreApiBaseUrl("http://localhost:8787/v1/")).toBe(
      "http://localhost:8787/v1",
    );
  });

  it("keeps coreApiBaseUrl exported for chat compatibility", async () => {
    withRelatedProjectMock.mockReturnValue("https://core.example.com");

    const { coreApiBaseUrl } = await import("../core.client");

    expect(coreApiBaseUrl).toBe("https://core.example.com");
    expect(withRelatedProjectMock).toHaveBeenCalledWith({
      defaultHost: "http://localhost:8787",
      projectName: "sokosumi-core-mainnet",
    });
  });

  it("executes generated operations through the transport adapter", async () => {
    getConversationsMock.mockResolvedValue({
      data: {
        data: [],
        meta: {
          requestId: "req_123",
          timestamp: new Date("2026-02-19T12:00:00.000Z"),
        },
      },
      response: new Response("{}", { status: 200 }),
    });

    const { coreClient } = await import("../core.client");
    const response = await coreClient.getConversations();

    expect(getCoreTransportAdapterMock).toHaveBeenCalledTimes(1);
    expect(createGeneratedClientMock).toHaveBeenCalledTimes(1);
    expect(getConversationsMock).toHaveBeenCalledWith({
      cache: "no-store",
      client: mockClient,
    });
    expect(response.meta?.timestamp).toEqual(
      new Date("2026-02-19T12:00:00.000Z"),
    );
  });

  it("fetches agent input schemas through the transport adapter", async () => {
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

    const { coreClient } = await import("../core.client");
    const response = await coreClient.getAgentInputSchema("agent_1");

    expect(createGeneratedClientMock).toHaveBeenCalledTimes(1);
    expect(getAgentsByIdInputSchemaMock).toHaveBeenCalledWith({
      client: mockClient,
      path: { id: "agent_1" },
    });
    expect(response.data.input_data).toHaveLength(1);
  });

  it("raises CoreApiRequestError for agent input schema failures", async () => {
    getAgentsByIdInputSchemaMock.mockResolvedValue({
      error: {
        error: "Unauthorized",
        message: "Please sign in",
      },
      response: new Response("{}", { status: 401 }),
    });

    const { CoreApiRequestError, coreClient } = await import("../core.client");

    await expect(coreClient.getAgentInputSchema("agent_1")).rejects.toEqual(
      expect.objectContaining<Partial<InstanceType<typeof CoreApiRequestError>>>(
        {
          details: {
            error: "Unauthorized",
            message: "Please sign in",
          },
          message: "Please sign in",
          name: "CoreApiRequestError",
          status: 401,
        },
      ),
    );
  });

  it("executes user credit and organization operations through the transport adapter", async () => {
    getUsersMeCreditsMock.mockResolvedValue({
      data: {
        data: {
          credits: {
            subscription: null,
            buffer: 42,
            total: 42,
          },
        },
      },
      response: new Response("{}", { status: 200 }),
    });
    getUsersMeOrganizationsMock.mockResolvedValue({
      data: {
        data: [{ id: "org_1", name: "Acme", slug: "acme" }],
      },
      response: new Response("{}", { status: 200 }),
    });

    const { coreClient } = await import("../core.client");

    await coreClient.getMyCredits();
    await coreClient.getMyOrganizations();

    expect(getUsersMeCreditsMock).toHaveBeenCalledWith({
      cache: "no-store",
      client: mockClient,
    });
    expect(getUsersMeOrganizationsMock).toHaveBeenCalledWith({
      cache: "no-store",
      client: mockClient,
    });
  });

  it("maps status codes and service-unavailable errors to action errors", async () => {
    const {
      CoreApiRequestError,
      mapCoreApiStatusToCommonErrorCode,
      toCoreApiActionError,
    } = await import("../core.client");
    const { CommonErrorCode } = await import("@/lib/actions/errors");

    expect(mapCoreApiStatusToCommonErrorCode(401)).toBe(
      CommonErrorCode.UNAUTHORIZED,
    );
    expect(mapCoreApiStatusToCommonErrorCode(404)).toBe(
      CommonErrorCode.BAD_INPUT,
    );
    expect(mapCoreApiStatusToCommonErrorCode(503)).toBe(
      CommonErrorCode.INTERNAL_SERVER_ERROR,
    );

    expect(
      toCoreApiActionError(
        new CoreApiRequestError("Conversation missing", { status: 404 }),
      ),
    ).toEqual({
      code: CommonErrorCode.BAD_INPUT,
      message: "Conversation missing",
    });

    expect(
      toCoreApiActionError(
        new CoreApiRequestError("Core backend timeout", { status: 503 }),
      ),
    ).toEqual({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: "The service is currently unavailable.",
    });
  });

  it("fetches pending notices through the transport adapter", async () => {
    getUsersMeNoticesPendingMock.mockResolvedValue({
      data: {
        data: {
          pendingNotices: [
            {
              id: "notice_1",
              kind: "ANNOUNCEMENT",
              bodyMarkdown: "# Hello",
              effectiveAt: new Date("2026-02-20T10:00:00.000Z"),
              isActive: true,
              createdAt: new Date("2026-02-19T10:00:00.000Z"),
              updatedAt: new Date("2026-02-19T10:00:00.000Z"),
            },
          ],
        },
      },
      response: new Response("{}", { status: 200 }),
    });

    const { coreClient } = await import("../core.client");
    const response = await coreClient.getPendingNotices();

    expect(getUsersMeNoticesPendingMock).toHaveBeenCalledWith({
      cache: "no-store",
      client: mockClient,
    });
    expect(response).toHaveLength(1);
  });

  it("acknowledges notices through the transport adapter", async () => {
    postUsersMeNoticesByIdAcknowledgeMock.mockResolvedValue({
      data: {
        data: {
          noticeId: "notice_1",
          acknowledgedAt: new Date("2026-02-20T11:00:00.000Z"),
          alreadyAcknowledged: false,
        },
      },
      response: new Response("{}", { status: 200 }),
    });

    const { coreClient } = await import("../core.client");
    const response = await coreClient.acknowledgeNotice("notice_1");

    expect(postUsersMeNoticesByIdAcknowledgeMock).toHaveBeenCalledWith({
      client: mockClient,
      path: { id: "notice_1" },
    });
    expect(response.noticeId).toBe("notice_1");
  });
});
