import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const { conversationFindFirstMock, conversationUpdateManyMock } = vi.hoisted(
  () => ({
    conversationFindFirstMock: vi.fn(),
    conversationUpdateManyMock: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    conversation: {
      findFirst: conversationFindFirstMock,
      updateMany: conversationUpdateManyMock,
    },
  },
}));

import {
  COWORKER_CHAT_BILLING_MESSAGE,
  CoworkerConversationError,
  createCoworkerConversation,
  ensureCoworkerProviderConversation,
  throwCoworkerRemoteConversationHttpError,
} from "./coworker-conversation";

const DEFAULT_BASE_URL = "https://api.coworker.example.com/v1";

describe("coworker-conversation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
    conversationFindFirstMock.mockReset();
    conversationUpdateManyMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when responsesApiBaseUrl is missing", async () => {
    fetchMock.mockClear();
    await expect(
      createCoworkerConversation({
        responsesApiBaseUrl: "",
        sokosumiUserId: "user_1",
        sokosumiOrganizationId: null,
        coworkerSlug: "ops-agent",
        sokosumiConversationId: "conv-local-1",
      }),
    ).rejects.toThrow("Responses API base URL is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs /conversations with metadata and Sokosumi identity headers", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "conv_remote_1" }),
    });

    const result = await createCoworkerConversation({
      responsesApiBaseUrl: DEFAULT_BASE_URL,
      sokosumiUserId: "user_1",
      sokosumiOrganizationId: "org_1",
      coworkerSlug: "ops-agent",
      sokosumiConversationId: "conv-local-1",
    });

    expect(result).toEqual({ id: "conv_remote_1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.coworker.example.com/v1/conversations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Sokosumi-User-Id": "user_1",
          "X-Coworker-Slug": "ops-agent",
          "X-Sokosumi-Organization-Id": "org_1",
        }),
      }),
    );
    const [, initWithOrg] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(initWithOrg.headers["X-Sokosumi-User-Id"]).toBe("user_1");
    expect(initWithOrg.headers["X-Sokosumi-Organization-Id"]).toBe("org_1");
    expect(JSON.parse(initWithOrg.body)).toEqual({
      metadata: {
        sokosumi_user_id: "user_1",
        sokosumi_organization_id: "org_1",
        coworker_slug: "ops-agent",
        sokosumi_conversation_id: "conv-local-1",
      },
    });
  });

  it("accepts id nested under data in JSON body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: "conv_nested" } }),
    });

    const result = await createCoworkerConversation({
      responsesApiBaseUrl: DEFAULT_BASE_URL,
      sokosumiUserId: "user_1",
      sokosumiOrganizationId: null,
      coworkerSlug: "ops-agent",
      sokosumiConversationId: "conv-local-1",
    });

    expect(result).toEqual({ id: "conv_nested" });

    const [, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(init.headers["X-Sokosumi-User-Id"]).toBe("user_1");
    expect(init.headers["X-Sokosumi-Organization-Id"]).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({
      metadata: {
        sokosumi_user_id: "user_1",
        coworker_slug: "ops-agent",
        sokosumi_conversation_id: "conv-local-1",
      },
    });
  });

  it("throws CoworkerConversationError with billing_required on OpenAI 403", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({
          error: {
            message: "Account setup or billing required",
            type: "invalid_request_error",
            code: "billing_required",
          },
        }),
    });

    await expect(
      createCoworkerConversation({
        responsesApiBaseUrl: DEFAULT_BASE_URL,
        sokosumiUserId: "user_1",
        sokosumiOrganizationId: null,
        coworkerSlug: "ops-agent",
        sokosumiConversationId: "conv-local-1",
      }),
    ).rejects.toMatchObject({
      name: "CoworkerConversationError",
      upstreamStatus: 403,
      upstreamCode: "billing_required",
    });
  });
});

describe("ensureCoworkerProviderConversation", () => {
  const ensureOptions = {
    internalConversationId: "conv-local-1",
    userId: "user_1",
    organizationId: null,
    coworkerSlug: "ops-agent",
    responsesApiBaseUrl: DEFAULT_BASE_URL,
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    conversationFindFirstMock.mockReset();
    conversationUpdateManyMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockRemoteConversationCreate(id = "conv_remote_new") {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id }),
    });
  }

  it("returns an existing provider conversation id without creating a remote conversation", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      providerConversationId: "conv_remote_existing",
    });

    const result = await ensureCoworkerProviderConversation(ensureOptions);

    expect(result).toEqual({
      providerConversationId: "conv_remote_existing",
      justCreated: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(conversationUpdateManyMock).not.toHaveBeenCalled();
  });

  it("returns the refetched id when a concurrent write wins the race", async () => {
    conversationFindFirstMock
      .mockResolvedValueOnce({ providerConversationId: null })
      .mockResolvedValueOnce({ providerConversationId: "conv_remote_winner" });
    conversationUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    mockRemoteConversationCreate();

    const result = await ensureCoworkerProviderConversation(ensureOptions);

    expect(result).toEqual({
      providerConversationId: "conv_remote_winner",
      justCreated: false,
    });
  });

  it("throws when updateMany loses the race and no provider id is persisted", async () => {
    conversationFindFirstMock
      .mockResolvedValueOnce({ providerConversationId: null })
      .mockResolvedValueOnce({ providerConversationId: null });
    conversationUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    mockRemoteConversationCreate();

    await expect(
      ensureCoworkerProviderConversation(ensureOptions),
    ).rejects.toMatchObject({
      name: "CoworkerConversationError",
      upstreamStatus: 503,
    });
  });
});

describe("throwCoworkerRemoteConversationHttpError", () => {
  it("maps billing_required to 403 with a user-facing message", () => {
    expect(() =>
      throwCoworkerRemoteConversationHttpError(
        new CoworkerConversationError(
          "Conversations API request failed",
          403,
          "billing_required",
        ),
      ),
    ).toThrow(
      expect.objectContaining({
        status: 403,
        message: COWORKER_CHAT_BILLING_MESSAGE,
      }),
    );
  });

  it("maps unexpected upstream 5xx to 503 without reporting to Sentry", () => {
    expect(() =>
      throwCoworkerRemoteConversationHttpError(
        new CoworkerConversationError("Conversations API request failed", 502),
      ),
    ).toThrow(
      expect.objectContaining({
        status: 503,
        cause: expect.objectContaining({ reportToSentry: false }),
      }),
    );
  });
});
