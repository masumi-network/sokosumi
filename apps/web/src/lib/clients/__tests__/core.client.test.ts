jest.mock("server-only", () => ({}));

const headersMock = jest.fn();
const getConversationsMock = jest.fn();
const getUsersMeCreditsMock = jest.fn();
const getUsersMeOrganizationsMock = jest.fn();
const getEnvSecretsMock = jest.fn();
const mockClient = { id: "core-client" } as never;
const createClientMock = jest.fn(() => mockClient);

jest.mock("next/headers", () => ({
  headers: (...args: unknown[]) => headersMock(...args),
}));

jest.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => getEnvSecretsMock(),
}));

jest.mock("@/lib/clients/generated/core/client", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

jest.mock("@/lib/clients/generated/core", () => ({
  getConversations: (...args: unknown[]) => getConversationsMock(...args),
  getUsersMeCredits: (...args: unknown[]) => getUsersMeCreditsMock(...args),
  getUsersMeOrganizations: (...args: unknown[]) =>
    getUsersMeOrganizationsMock(...args),
}));

describe("core.client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    headersMock.mockResolvedValue(new Headers());
    getEnvSecretsMock.mockReturnValue({
      CORE_API_URL: "http://localhost:3001",
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

    expect(normalizeCoreApiBaseUrl("http://localhost:3001")).toBe(
      "http://localhost:3001/v1",
    );
    expect(normalizeCoreApiBaseUrl("http://localhost:3001/v1")).toBe(
      "http://localhost:3001/v1",
    );
    expect(normalizeCoreApiBaseUrl("http://localhost:3001/v1/")).toBe(
      "http://localhost:3001/v1",
    );
  });

  it("forwards auth headers and uses normalized base url for generated operations", async () => {
    headersMock.mockResolvedValue(
      new Headers({
        cookie: "session=abc",
        "x-organization-slug": "my-org",
      }),
    );
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
      baseUrl: "http://localhost:3001/v1",
      headers: {
        cookie: "session=abc",
      },
    });
    expect(getConversationsMock).toHaveBeenCalledWith({
      cache: "no-store",
      client: mockClient,
    });
    expect(response.meta?.timestamp).toEqual(
      new Date("2026-02-19T12:00:00.000Z"),
    );
  });

  it("executes user credit and organization operations through the generated client", async () => {
    getUsersMeCreditsMock.mockResolvedValue({
      data: {
        data: { credits: 42 },
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
});
