import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const getConversationsMock = vi.fn();
const getAgentsByIdInputSchemaMock = vi.fn();
const getShareByTokenMock = vi.fn();
const getHistoryMock = vi.fn();
const getTasksByIdMock = vi.fn();
const getUsersByIdNoticesPendingMock = vi.fn();
const postUsersByIdNoticesByNoticeIdAcknowledgeMock = vi.fn();
const putJobsByIdShareMock = vi.fn();
const putTasksByIdShareMock = vi.fn();
const getUsersByIdCreditsMock = vi.fn();
const getUsersByIdOrganizationsMock = vi.fn();
const deleteJobsByIdShareMock = vi.fn();
const deleteTasksByIdShareMock = vi.fn();
const postAgentsByIdJobsMock = vi.fn();
const createClientMock = vi.fn();
const headersMock = vi.fn();
const mockClient = {
  id: "core-client",
} as never;

vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreApiBaseUrl: () => "http://localhost:8787/v1",
  getCoreApiBaseUrl: () => "http://localhost:8787/v1",
}));

vi.mock("@/lib/clients/generated/core/client", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/clients/generated/core", () => ({
  deleteJobsByIdShare: deleteJobsByIdShareMock,
  deleteTasksByIdShare: deleteTasksByIdShareMock,
  getAgentsByIdInputSchema: getAgentsByIdInputSchemaMock,
  getConversations: getConversationsMock,
  getHistory: getHistoryMock,
  getShareByToken: getShareByTokenMock,
  getTasksById: getTasksByIdMock,
  getUsersByIdNoticesPending: getUsersByIdNoticesPendingMock,
  postUsersByIdNoticesByNoticeIdAcknowledge:
    postUsersByIdNoticesByNoticeIdAcknowledgeMock,
  getUsersByIdCredits: getUsersByIdCreditsMock,
  getUsersByIdOrganizations: getUsersByIdOrganizationsMock,
  postAgentsByIdJobs: postAgentsByIdJobsMock,
  putJobsByIdShare: putJobsByIdShareMock,
  putTasksByIdShare: putTasksByIdShareMock,
}));

describe("core.client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    redirectMock.mockClear();

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

  it("creates agent jobs through the server transport", async () => {
    postAgentsByIdJobsMock.mockResolvedValue({
      data: {
        data: {
          id: "job_123",
          createdAt: new Date("2026-02-19T12:00:00.000Z"),
          updatedAt: new Date("2026-02-19T12:00:00.000Z"),
          agentId: "agent_1",
          userId: "user_1",
          user: {
            id: "user_1",
            name: "Ada Lovelace",
            image: null,
          },
          organizationId: null,
          organization: null,
          workspace: {
            id: "workspace_1",
            organizationId: null,
            organization: null,
          },
          taskId: null,
          name: null,
          jobType: "PAID",
          status: "started",
          credits: 5,
          onChainStatus: null,
          onChainTransactionHash: null,
          result: null,
          resultHash: null,
        },
        meta: {
          requestId: "req_123",
          timestamp: new Date("2026-02-19T12:00:00.000Z"),
        },
      },
      response: new Response("{}", { status: 201 }),
    });

    const { coreClient } = await import("../core.client");
    const response = await coreClient.createAgentJob("agent_1", {
      inputSchema: { input_data: [] },
      inputData: { prompt: "hello" },
      maxCredits: 5,
    });

    expect(postAgentsByIdJobsMock).toHaveBeenCalledWith({
      body: {
        inputSchema: { input_data: [] },
        inputData: { prompt: "hello" },
        maxCredits: 5,
      },
      client: mockClient,
      path: { id: "agent_1" },
    });
    expect(response.data.id).toBe("job_123");
  });

  it("redirects to signin for unauthorized agent input schema requests", async () => {
    getAgentsByIdInputSchemaMock.mockResolvedValue({
      error: {
        error: "Unauthorized",
        message: "Please sign in",
      },
      response: new Response("{}", { status: 401 }),
    });
    headersMock.mockResolvedValue(
      new Headers({
        cookie: "session=abc",
        "x-organization-slug": "my-org",
        "x-pathname": "/agents/agent_1",
        "x-search-params": "",
      }),
    );

    const { coreClient } = await import("../core.client");

    await expect(coreClient.getAgentInputSchema("agent_1")).rejects.toThrow(
      "REDIRECT:/signin?returnUrl=%2Fagents%2Fagent_1",
    );
    expect(redirectMock).toHaveBeenCalledWith(
      "/signin?returnUrl=%2Fagents%2Fagent_1",
    );
  });

  it("executes user credit and organization operations through the server transport", async () => {
    getUsersByIdCreditsMock.mockResolvedValue({
      data: {
        data: {
          subscription: null,
          credits: {
            subscription: null,
            buffer: 42,
            total: 42,
          },
          extra: {
            credits: { total: 0, remaining: 0, used: 0 },
            buckets: [],
          },
        },
      },
      response: new Response("{}", { status: 200 }),
    });
    getUsersByIdOrganizationsMock.mockResolvedValue({
      data: {
        data: [{ id: "org_1", name: "Acme", slug: "acme" }],
      },
      response: new Response("{}", { status: 200 }),
    });

    const { coreClient } = await import("../core.client");

    await coreClient.getMyCredits();
    await coreClient.getMyOrganizations();

    expect(createClientMock).toHaveBeenCalledTimes(2);
    expect(getUsersByIdCreditsMock).toHaveBeenCalledWith({
      cache: "no-store",
      client: mockClient,
      path: { id: "me" },
    });
    expect(getUsersByIdOrganizationsMock).toHaveBeenCalledWith({
      cache: "no-store",
      client: mockClient,
      path: { id: "me" },
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
      CommonErrorCode.NOT_FOUND,
    );
    expect(mapCoreApiStatusToCommonErrorCode(503)).toBe(
      CommonErrorCode.INTERNAL_SERVER_ERROR,
    );

    expect(
      toCoreApiActionError(
        new CoreApiRequestError("Conversation missing", { status: 404 }),
      ),
    ).toEqual({
      code: CommonErrorCode.NOT_FOUND,
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
    getUsersByIdNoticesPendingMock.mockResolvedValue({
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

    expect(getUsersByIdNoticesPendingMock).toHaveBeenCalledWith({
      cache: "no-store",
      client: mockClient,
      path: { id: "me" },
    });
    expect(response).toHaveLength(1);
  });

  it("acknowledges notices through the server transport", async () => {
    postUsersByIdNoticesByNoticeIdAcknowledgeMock.mockResolvedValue({
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

    expect(postUsersByIdNoticesByNoticeIdAcknowledgeMock).toHaveBeenCalledWith({
      client: mockClient,
      path: { id: "me", noticeId: "notice_1" },
    });
    expect(response.noticeId).toBe("notice_1");
  });

  it("updates public job shares through the server transport", async () => {
    putJobsByIdShareMock.mockResolvedValue({
      data: {
        data: {
          id: "share_1",
          jobId: "job_1",
          token: "public-share-token",
          allowSearchIndexing: true,
          createdAt: new Date("2026-03-26T10:00:00.000Z"),
          updatedAt: new Date("2026-03-26T10:00:00.000Z"),
        },
      },
      response: new Response("{}", { status: 200 }),
    });

    const { coreClient } = await import("../core.client");
    const response = await coreClient.putJobShare("job_1", {
      allowSearchIndexing: true,
    });

    expect(putJobsByIdShareMock).toHaveBeenCalledWith({
      body: {
        allowSearchIndexing: true,
      },
      client: mockClient,
      path: {
        id: "job_1",
      },
    });
    expect(response.createdAt).toEqual(new Date("2026-03-26T10:00:00.000Z"));
    expect(response.token).toBe("public-share-token");
  });

  it("fetches shared jobs through the canonical public server transport", async () => {
    getShareByTokenMock.mockResolvedValue({
      data: {
        data: {
          kind: "job",
          // Wire-shaped ISO strings: the generated `getShareByToken`
          // transformer only revives `meta.timestamp` (the union payload is
          // skipped by the generator), so date revival is the mapper's job —
          // the Date assertions below prove it.
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
            agentId: "agent_1",
            userId: "user_1",
            organizationId: "org_1",
            taskId: null,
            name: "Shared Job",
            jobType: "PAID",
            status: "completed",
            credits: 5,
            onChainStatus: null,
            onChainTransactionHash: "0x123abc",
            result: "# Result",
            input: '{"prompt":"hello"}',
            inputHash: null,
            inputSchema: '{"input_data":[]}',
            agentJobId: "agent_job_1",
            identifierFromPurchaser: "identifier_123",
            user: {
              id: "user_1",
              name: "Ada Lovelace",
              image: null,
            },
            organization: {
              id: "org_1",
              name: "Acme Labs",
              slug: "acme-labs",
            },
            workspace: {
              id: "workspace_1",
              organizationId: "org_1",
              organization: {
                id: "org_1",
                name: "Acme Labs",
                slug: "acme-labs",
              },
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
            resultHash: "result_hash_123",
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
                inputSchema: '{"input_data":[]}',
                input: {
                  id: "input_1",
                  input: '{"prompt":"hello"}',
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
    const response =
      await coreClient.getSharedResourceByToken("public-share-token");

    expect(getShareByTokenMock).toHaveBeenCalledWith({
      cache: "no-store",
      client: mockClient,
      path: {
        token: "public-share-token",
      },
    });
    expect(response.kind).toBe("job");
    if (response.kind !== "job") {
      throw new Error("Expected a shared job response");
    }
    expect(response.share.createdAt).toEqual(
      new Date("2026-03-26T10:00:00.000Z"),
    );
    expect(response.share.allowSearchIndexing).toBe(false);
    expect(response.job.createdAt).toEqual(
      new Date("2026-03-26T10:00:00.000Z"),
    );
    expect(response.job.updatedAt).toEqual(
      new Date("2026-03-26T10:05:00.000Z"),
    );
    expect(response.job.completedAt).toEqual(
      new Date("2026-03-26T10:10:00.000Z"),
    );
    expect(response.job.credits).toBe(5);
    expect(response.job.onChainTransactionHash).toBe("0x123abc");
    expect(response.job.onChainStatus).toBeNull();
    expect(response.job.organization).toEqual({
      id: "org_1",
      name: "Acme Labs",
      slug: "acme-labs",
    });
    expect(response.job.share?.token).toBe("public-share-token");
    expect(response.job.events[0]?.createdAt).toEqual(
      new Date("2026-03-26T10:10:00.000Z"),
    );
  });

  it("fetches shared tasks through the canonical public server transport", async () => {
    getShareByTokenMock.mockResolvedValue({
      data: {
        data: {
          kind: "task",
          share: {
            id: "share_1",
            taskId: "task_1",
            token: "public-share-token",
            allowSearchIndexing: false,
            createdAt: "2026-03-26T10:00:00.000Z",
            updatedAt: "2026-03-26T10:00:00.000Z",
          },
          task: {
            id: "task_1",
            createdAt: "2026-03-26T10:00:00.000Z",
            updatedAt: "2026-03-26T10:05:00.000Z",
            name: "Shared Task",
            description: null,
            status: "READY",
            coworker: null,
            jobs: [
              {
                id: "job_1",
                createdAt: "2026-03-26T10:10:00.000Z",
                completedAt: null,
                name: "Shared Job",
                status: "completed",
                agentName: "Research Agent",
                shareToken: null,
              },
            ],
            events: [
              {
                id: "event_1",
                createdAt: "2026-03-26T10:20:00.000Z",
                updatedAt: "2026-03-26T10:20:00.000Z",
                origin: "SOKOSUMI",
                status: "READY",
                credits: null,
              },
            ],
          },
        },
      },
      response: new Response("{}", { status: 200 }),
    });

    const { coreClient } = await import("../core.client");
    const response =
      await coreClient.getSharedResourceByToken("public-share-token");

    expect(getShareByTokenMock).toHaveBeenCalledWith({
      cache: "no-store",
      client: mockClient,
      path: {
        token: "public-share-token",
      },
    });
    expect(response.kind).toBe("task");
    if (response.kind !== "task") {
      throw new Error("Expected a shared task response");
    }
    expect(response.share.taskId).toBe("task_1");
    expect(response.task.name).toBe("Shared Task");
    expect(response.share.createdAt).toEqual(
      new Date("2026-03-26T10:00:00.000Z"),
    );
    expect(response.task.createdAt).toEqual(
      new Date("2026-03-26T10:00:00.000Z"),
    );
    expect(response.task.jobs[0]?.createdAt).toEqual(
      new Date("2026-03-26T10:10:00.000Z"),
    );
    expect(response.task.jobs[0]?.agentName).toBe("Research Agent");
    expect(response.task.events[0]?.createdAt).toEqual(
      new Date("2026-03-26T10:20:00.000Z"),
    );
  });

  it("normalizes history updatedAt and archivedAt strings through the server transport", async () => {
    getHistoryMock.mockImplementation(
      async (options: {
        responseTransformer?: (data: unknown) => Promise<unknown>;
      }) => {
        const rawResponse = {
          data: [
            {
              kind: "task",
              id: "task_1",
              title: "Review onboarding",
              description: null,
              status: "READY",
              updatedAt: "2026-02-19T10:00:00.000Z",
              archivedAt: "2026-02-20T10:00:00.000Z",
              credits: 2,
              projectId: null,
              coworkerId: null,
            },
          ],
          meta: {
            requestId: "req_123",
            timestamp: "2026-02-19T12:00:00.000Z",
            pagination: {
              cursor: null,
              limit: 20,
              total: 1,
              nextCursor: null,
            },
          },
        };

        return {
          data: options.responseTransformer
            ? await options.responseTransformer(rawResponse)
            : rawResponse,
          response: new Response("{}", { status: 200 }),
        };
      },
    );

    const { coreClient } = await import("../core.client");
    const response = await coreClient.getHistory({ limit: 20 });

    expect(getHistoryMock).toHaveBeenCalledWith({
      cache: "no-store",
      client: mockClient,
      query: { limit: 20 },
      responseTransformer: expect.any(Function),
    });
    expect(response.data[0]?.updatedAt).toEqual(
      new Date("2026-02-19T10:00:00.000Z"),
    );
    expect(response.data[0]?.archivedAt).toEqual(
      new Date("2026-02-20T10:00:00.000Z"),
    );
    expect(response.meta?.timestamp).toEqual(
      new Date("2026-02-19T12:00:00.000Z"),
    );
  });

  it("normalizes nullable task shares through the server transport", async () => {
    getTasksByIdMock.mockImplementation(
      async (options: {
        responseTransformer?: (data: unknown) => Promise<unknown>;
      }) => {
        const rawResponse = {
          data: {
            id: "task_1",
            createdAt: "2026-03-26T10:00:00.000Z",
            updatedAt: "2026-03-26T10:05:00.000Z",
            userId: "user_1",
            organizationId: null,
            coworkerId: null,
            name: "Task",
            description: null,
            status: "DRAFT",
            credits: 0,
            events: [],
            jobs: [],
            share: null,
            links: [],
          },
          meta: {
            requestId: "req_123",
            timestamp: "2026-03-26T10:00:00.000Z",
          },
        };

        return {
          data: options.responseTransformer
            ? await options.responseTransformer(rawResponse)
            : rawResponse,
          response: new Response("{}", { status: 200 }),
        };
      },
    );

    const { coreClient } = await import("../core.client");
    const response = await coreClient.getTaskById("task_1");

    expect(getTasksByIdMock).toHaveBeenCalledWith({
      cache: "no-store",
      client: mockClient,
      path: { id: "task_1" },
      responseTransformer: expect.any(Function),
    });
    expect(response.data.share).toBeNull();
    expect(response.data.createdAt).toEqual(
      new Date("2026-03-26T10:00:00.000Z"),
    );
    expect(response.meta?.timestamp).toEqual(
      new Date("2026-03-26T10:00:00.000Z"),
    );
  });

  it("updates public task shares through the server transport", async () => {
    putTasksByIdShareMock.mockResolvedValue({
      data: {
        data: {
          id: "share_1",
          taskId: "task_1",
          token: "public-share-token",
          allowSearchIndexing: true,
          createdAt: new Date("2026-03-26T10:00:00.000Z"),
          updatedAt: new Date("2026-03-26T10:00:00.000Z"),
        },
      },
      response: new Response("{}", { status: 200 }),
    });

    const { coreClient } = await import("../core.client");
    const response = await coreClient.putTaskShare("task_1", {
      allowSearchIndexing: true,
    });

    expect(putTasksByIdShareMock).toHaveBeenCalledWith({
      body: {
        allowSearchIndexing: true,
      },
      client: mockClient,
      path: {
        id: "task_1",
      },
    });
    expect(response.taskId).toBe("task_1");
    expect(response.token).toBe("public-share-token");
  });

  it("deletes public job shares through the server transport", async () => {
    deleteJobsByIdShareMock.mockResolvedValue({
      data: {
        data: {},
      },
      response: new Response("{}", { status: 200 }),
    });

    const { coreClient } = await import("../core.client");
    await coreClient.deleteJobShare("job_1");

    expect(deleteJobsByIdShareMock).toHaveBeenCalledWith({
      client: mockClient,
      path: {
        id: "job_1",
      },
    });
  });

  it("deletes public task shares through the server transport", async () => {
    deleteTasksByIdShareMock.mockResolvedValue({
      data: {
        data: {},
      },
      response: new Response("{}", { status: 200 }),
    });

    const { coreClient } = await import("../core.client");
    await coreClient.deleteTaskShare("task_1");

    expect(deleteTasksByIdShareMock).toHaveBeenCalledWith({
      client: mockClient,
      path: {
        id: "task_1",
      },
    });
  });
});
