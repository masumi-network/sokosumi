import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const coreClientMock = {
  addConversationItem: vi.fn(),
  archiveConversation: vi.fn(),
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  getConversationItems: vi.fn(),
  getConversations: vi.fn(),
  updateConversation: vi.fn(),
};
const toCoreApiActionErrorMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: coreClientMock,
  toCoreApiActionError: toCoreApiActionErrorMock,
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: Record<string, unknown>) => Promise<unknown>) =>
    async (params: Record<string, unknown>) => {
      const nextParams = params.session
        ? params
        : {
            ...params,
            session: {
              user: {
                id: "user-1",
              },
              session: {
                activeOrganizationId: null,
              },
            },
          };
      return handler(nextParams);
    },
}));

const session = {
  user: {
    id: "user-1",
  },
  session: {
    activeOrganizationId: null,
  },
} as never;

describe("core conversation api actions", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { CommonErrorCode } = await import("@/lib/actions/errors");
    toCoreApiActionErrorMock.mockReturnValue({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: "Failed to communicate with Core API",
    });
  });

  it("lists conversations and normalizes date fields to strings", async () => {
    coreClientMock.getConversations.mockResolvedValue({
      data: [
        {
          id: "conv-1",
          userId: "user-1",
          title: "Chat title",
          metadata: { coworker: "hannah" },
          createdAt: new Date("2026-02-19T10:00:00.000Z"),
          updatedAt: new Date("2026-02-19T11:00:00.000Z"),
        },
      ],
    });

    const { listConversations } = await import("../core-api-actions");
    const result = await listConversations({ session });

    expect(coreClientMock.getConversations).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: "conv-1",
          userId: "user-1",
          title: "Chat title",
          metadata: { coworker: "hannah" },
          createdAt: "2026-02-19T10:00:00.000Z",
          updatedAt: "2026-02-19T11:00:00.000Z",
        },
      ],
    });
  });

  it("returns pagination metadata when loading conversation items", async () => {
    coreClientMock.getConversationItems.mockResolvedValue({
      data: [
        {
          id: "item-1",
          role: "user",
          content: "hello",
          createdAt: 1700000000,
        },
      ],
      meta: {
        pagination: {
          cursor: null,
          limit: 20,
          total: 42,
          nextCursor: "item-2",
        },
      },
    });

    const { getConversationItems } = await import("../core-api-actions");
    const result = await getConversationItems({
      session,
      conversationId: "conv-1",
      cursor: null,
      limit: 20,
    });

    expect(coreClientMock.getConversationItems).toHaveBeenCalledWith("conv-1", {
      cursor: undefined,
      limit: 20,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        items: [
          {
            id: "item-1",
            role: "user",
            content: "hello",
            createdAt: 1700000000,
          },
        ],
        pagination: {
          cursor: null,
          limit: 20,
          total: 42,
          nextCursor: "item-2",
        },
      },
    });
  });

  it("returns conversation without items when item loading fails", async () => {
    coreClientMock.getConversation.mockResolvedValue({
      data: {
        id: "conv-1",
        userId: "user-1",
        title: "Chat title",
        metadata: null,
        createdAt: new Date("2026-02-19T10:00:00.000Z"),
        updatedAt: new Date("2026-02-19T11:00:00.000Z"),
      },
    });
    coreClientMock.getConversationItems.mockRejectedValue(
      new Error("items failed"),
    );

    const { getConversation } = await import("../core-api-actions");
    const result = await getConversation({
      session,
      id: "conv-1",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        id: "conv-1",
        userId: "user-1",
        title: "Chat title",
        metadata: null,
        createdAt: "2026-02-19T10:00:00.000Z",
        updatedAt: "2026-02-19T11:00:00.000Z",
        items: [],
      },
    });
  });

  it("returns mapped action errors when core client fails", async () => {
    const { CommonErrorCode } = await import("@/lib/actions/errors");
    coreClientMock.getConversations.mockRejectedValue(
      new Error("conversation service is down"),
    );
    toCoreApiActionErrorMock.mockReturnValue({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: "The service is currently unavailable.",
    });

    const { listConversations } = await import("../core-api-actions");
    const result = await listConversations({ session });

    expect(result).toEqual({
      ok: false,
      error: {
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        message: "The service is currently unavailable.",
      },
    });
  });

  it("returns the created conversation item id", async () => {
    coreClientMock.addConversationItem.mockResolvedValue({
      data: {
        id: "item-123",
        role: "user",
        content: "hello",
        createdAt: new Date(1700000000),
      },
    });

    const { addConversationItem } = await import("../core-api-actions");
    const result = await addConversationItem({
      session,
      conversationId: "conv-1",
      role: "user",
      content: "hello",
    });

    expect(coreClientMock.addConversationItem).toHaveBeenCalledWith("conv-1", {
      role: "user",
      content: "hello",
    });
    expect(result).toEqual({
      ok: true,
      data: { id: "item-123" },
    });
  });
});
