import { beforeEach, describe, expect, it, vi } from "vitest";
export {};

vi.mock("server-only", () => ({}));

const getConversationsMock = vi.fn();
const getAgentsByIdInputSchemaMock = vi.fn();
const getUsersMeNoticesPendingMock = vi.fn();
const postUsersMeNoticesByIdAcknowledgeMock = vi.fn();
const getUsersMeCreditsMock = vi.fn();
const getUsersMeOrganizationsMock = vi.fn();
const clientDeleteMock = vi.fn();
const clientGetMock = vi.fn();
const clientPutMock = vi.fn();
const createClientMock = vi.fn();
const headersMock = vi.fn();
const mockClient = {
  delete: (...args: unknown[]) => clientDeleteMock(...args),
  get: (...args: unknown[]) => clientGetMock(...args),
  id: "core-client",
  put: (...args: unknown[]) => clientPutMock(...args),
} as never;

vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreApiBaseUrl: () => "http://localhost:8787/v1",
  getCoreApiBaseUrl: () => "http://localhost:8787/v1",
}));

vi.mock("@/lib/clients/generated/core/client", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/clients/generated/core", () => ({
  getAgentsByIdInputSchema: getAgentsByIdInputSchemaMock,
  getConversations: getConversationsMock,
  getUsersMeNoticesPending: getUsersMeNoticesPendingMock,
  postUsersMeNoticesByIdAcknowledge: postUsersMeNoticesByIdAcknowledgeMock,
  getUsersMeCredits: getUsersMeCreditsMock,
  getUsersMeOrganizations: getUsersMeOrganizationsMock,
}));

describe("core.client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    headersMock.mockResolvedValue(
      new Headers({
        cookie: "session=abc",
        "x-organization-slug": "my-org",
      }),
    );
    createClientMock.mockReturnValue(mockClient);
  });

  it("executes generated operations through the generated client", async () => {
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

    expect(createClientMock).toHaveBeenCalledWith({
      baseUrl: "http://localhost:8787/v1",
      headers: { cookie: "session=abc" },
    });
    expect(getConversationsMock).toHaveBeenCalledWith({
      cache: "no-store",
      client: mockClient,
    });
    const forwardedHeaders = createClientMock.mock.calls[0]?.[0]?.headers as
      | Record<string, string>
      | undefined;
    expect(forwardedHeaders?.cookie).toBe("session=abc");
    expect(response.meta?.timestamp).toEqual(
      new Date("2026-02-19T12:00:00.000Z"),
    );
  });

  it("fetches agent input schemas through the server transport", async () => {
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

    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(getAgentsByIdInputSchemaMock).toHaveBeenCalledWith({
      client: mockClient,
      path: { id: "agent_1" },
    });
    expect("input_data" in response.data).toBe(true);
    if (!("input_data" in response.data)) {
      throw new Error("Expected flat input schema");
    }
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
      expect.objectContaining<
        Partial<InstanceType<typeof CoreApiRequestError>>
      >({
        details: {
          error: "Unauthorized",
          message: "Please sign in",
        },
        message: "Please sign in",
        name: "CoreApiRequestError",
        status: 401,
      }),
    );
  });

  it("executes user credit and organization operations through the server transport", async () => {
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

    expect(createClientMock).toHaveBeenCalledTimes(2);
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

  it("fetches pending notices through the server transport", async () => {
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

  it("acknowledges notices through the server transport", async () => {
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

  it("updates public job shares through the server transport", async () => {
    clientPutMock.mockResolvedValue({
      data: {
        data: {
          id: "share_1",
          jobId: "job_1",
          token: "public-share-token",
          allowSearchIndexing: true,
          createdAt: "2026-03-26T10:00:00.000Z",
          updatedAt: "2026-03-26T10:00:00.000Z",
        },
      },
      response: new Response("{}", { status: 200 }),
    });

    const { coreClient } = await import("../core.client");
    const response = await coreClient.putJobShare("job_1", {
      allowSearchIndexing: true,
    });

    expect(clientPutMock).toHaveBeenCalledWith({
      body: {
        allowSearchIndexing: true,
      },
      headers: {
        "Content-Type": "application/json",
      },
      path: {
        id: "job_1",
      },
      url: "/jobs/{id}/share",
    });
    expect(response.createdAt).toEqual(new Date("2026-03-26T10:00:00.000Z"));
    expect(response.token).toBe("public-share-token");
  });

  it("fetches shared jobs through the public server transport", async () => {
    clientGetMock.mockResolvedValue({
      data: {
        data: {
          share: {
            id: "share_1",
            jobId: "job_1",
            token: "public-share-token",
            allowSearchIndexing: false,
            createdAt: "2026-03-26T10:00:00.000Z",
            updatedAt: "2026-03-26T10:00:00.000Z",
          },
          job: {
            id: "job_1",
            createdAt: "2026-03-26T10:00:00.000Z",
            updatedAt: "2026-03-26T10:05:00.000Z",
            completedAt: "2026-03-26T10:10:00.000Z",
            taskId: null,
            name: "Shared Job",
            jobType: "PAID",
            status: "completed",
            credits: 5,
            agentJobId: "agent_job_1",
            identifierFromPurchaser: "identifier_123",
            user: {
              id: "user_1",
              name: "Ada Lovelace",
              image: null,
            },
            agent: {
              id: "agent_1",
              name: "Research Agent",
              overrideName: null,
              icon: null,
              image: null,
              overrideImage: null,
              legalPrivacyPolicy: null,
              overrideLegalPrivacyPolicy: null,
              legalTerms: null,
              overrideLegalTerms: null,
              legalDpa: null,
              overrideLegalDpa: null,
              legalOther: null,
              overrideLegalOther: null,
            },
            transaction: {
              amount: "5000000",
            },
            purchase: {
              onChainStatus: null,
              onChainTransactionHash: "0x123abc",
              resultHash: "result_hash_123",
            },
            events: [
              {
                id: "event_completed",
                createdAt: "2026-03-26T10:10:00.000Z",
                updatedAt: "2026-03-26T10:10:00.000Z",
                status: "COMPLETED",
                inputSchema: null,
                input: null,
                result: "# Result",
                blobs: [],
                links: [],
              },
              {
                id: "event_initiated",
                createdAt: "2026-03-26T10:00:00.000Z",
                updatedAt: "2026-03-26T10:00:00.000Z",
                status: "INITIATED",
                inputSchema: "{\"input_data\":[]}",
                input: {
                  id: "input_1",
                  input: "{\"prompt\":\"hello\"}",
                  inputHash: null,
                  signature: null,
                },
                result: null,
                blobs: [],
                links: [],
              },
            ],
          },
        },
      },
      response: new Response("{}", { status: 200 }),
    });

    const { coreClient } = await import("../core.client");
    const response = await coreClient.getSharedJobByToken("public-share-token");

    expect(clientGetMock).toHaveBeenCalledWith({
      cache: "no-store",
      path: {
        token: "public-share-token",
      },
      url: "/share/jobs/{token}",
    });
    expect(response.share.allowSearchIndexing).toBe(false);
    expect(response.job.createdAt).toEqual(new Date("2026-03-26T10:00:00.000Z"));
    expect(response.job.transaction?.amount).toBe(BigInt(5000000));
    expect(response.job.share?.token).toBe("public-share-token");
  });

  it("deletes public job shares through the server transport", async () => {
    clientDeleteMock.mockResolvedValue({
      data: {
        data: {},
      },
      response: new Response("{}", { status: 200 }),
    });

    const { coreClient } = await import("../core.client");
    await coreClient.deleteJobShare("job_1");

    expect(clientDeleteMock).toHaveBeenCalledWith({
      path: {
        id: "job_1",
      },
      url: "/jobs/{id}/share",
    });
  });
});
