import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  messageFindUniqueMock,
  mergeMetadataKeysMock,
  deleteMetadataKeysMock,
  ssrfSafeFetchMock,
  publishByIdMock,
} = vi.hoisted(() => ({
  messageFindUniqueMock: vi.fn(),
  mergeMetadataKeysMock: vi.fn(),
  deleteMetadataKeysMock: vi.fn(),
  ssrfSafeFetchMock: vi.fn(),
  publishByIdMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomMessage: {
      findUnique: messageFindUniqueMock,
    },
  },
}));

vi.mock("@sokosumi/net", () => ({
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtimeById: publishByIdMock,
}));

vi.mock("@/helpers/chat-room-message-metadata-patch", () => ({
  mergeChatRoomMessageMetadataKeys: (...args: unknown[]) =>
    mergeMetadataKeysMock(...args),
  deleteChatRoomMessageMetadataKeys: (...args: unknown[]) =>
    deleteMetadataKeysMock(...args),
}));

import { scheduleChatRoomMessageUnfurls } from "./chat-room-message-unfurl.service";

const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";

function htmlPage(title: string): string {
  return `<html><head><meta property="og:title" content="${title}"><meta property="og:description" content="Desc"><meta property="og:image" content="https://cdn.example/i.png"><meta property="og:site_name" content="Ex"></head></html>`;
}

describe("scheduleChatRoomMessageUnfurls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishByIdMock.mockResolvedValue(undefined);
    mergeMetadataKeysMock.mockResolvedValue(1);
    deleteMetadataKeysMock.mockResolvedValue(1);
  });

  it("no-ops when message is missing", async () => {
    messageFindUniqueMock.mockResolvedValue(null);

    const result = await scheduleChatRoomMessageUnfurls(MESSAGE_ID);

    expect(result).toEqual({
      messageId: MESSAGE_ID,
      attempted: 0,
      persisted: 0,
    });
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
    expect(mergeMetadataKeysMock).not.toHaveBeenCalled();
    expect(deleteMetadataKeysMock).not.toHaveBeenCalled();
  });

  it("no-ops when message is soft-deleted", async () => {
    messageFindUniqueMock.mockResolvedValue({
      id: MESSAGE_ID,
      content: "https://example.com",
      deletedAt: new Date(),
      editedAt: null,
      metadata: null,
    });

    const result = await scheduleChatRoomMessageUnfurls(MESSAGE_ID);

    expect(result.attempted).toBe(0);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("scrapes, atomically merges unfurls, and republishes", async () => {
    messageFindUniqueMock
      .mockResolvedValueOnce({
        id: MESSAGE_ID,
        content: "check https://example.com/page",
        deletedAt: null,
        editedAt: null,
        metadata: { quote: { messageId: "q1", authorName: "A", snippet: "s" } },
      })
      .mockResolvedValueOnce({
        id: MESSAGE_ID,
        content: "check https://example.com/page",
        deletedAt: null,
      });

    ssrfSafeFetchMock.mockResolvedValue(
      new Response(htmlPage("Page Title"), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    const result = await scheduleChatRoomMessageUnfurls(MESSAGE_ID);

    expect(result).toEqual({
      messageId: MESSAGE_ID,
      attempted: 1,
      persisted: 1,
    });
    expect(mergeMetadataKeysMock).toHaveBeenCalledWith({
      messageId: MESSAGE_ID,
      contentMustEqual: "check https://example.com/page",
      patch: {
        unfurls: [
          {
            url: "https://example.com/page",
            title: "Page Title",
            description: "Desc",
            imageUrl: "https://cdn.example/i.png",
            siteName: "Ex",
          },
        ],
      },
    });
    expect(deleteMetadataKeysMock).not.toHaveBeenCalled();
    expect(publishByIdMock).toHaveBeenCalledWith(MESSAGE_ID, "unfurl");
  });

  it("skips persist when content changed during scrape (stale)", async () => {
    messageFindUniqueMock
      .mockResolvedValueOnce({
        id: MESSAGE_ID,
        content: "https://example.com/old",
        deletedAt: null,
        editedAt: null,
        metadata: null,
      })
      .mockResolvedValueOnce({
        id: MESSAGE_ID,
        content: "https://example.com/new",
        deletedAt: null,
      });

    ssrfSafeFetchMock.mockResolvedValue(
      new Response(htmlPage("Old"), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const result = await scheduleChatRoomMessageUnfurls(MESSAGE_ID);

    expect(result.attempted).toBe(1);
    expect(result.persisted).toBe(0);
    expect(mergeMetadataKeysMock).not.toHaveBeenCalled();
    expect(deleteMetadataKeysMock).not.toHaveBeenCalled();
    expect(publishByIdMock).not.toHaveBeenCalled();
  });

  it("atomically clears unfurls key on empty scrape", async () => {
    messageFindUniqueMock
      .mockResolvedValueOnce({
        id: MESSAGE_ID,
        content: "no urls left",
        deletedAt: null,
        editedAt: new Date(),
        metadata: {
          quote: { messageId: "q1", authorName: "A", snippet: "s" },
          unfurls: [
            {
              url: "https://old.example",
              title: "Old",
              description: null,
              imageUrl: null,
              siteName: null,
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        id: MESSAGE_ID,
        content: "no urls left",
        deletedAt: null,
      });

    const result = await scheduleChatRoomMessageUnfurls(MESSAGE_ID);

    expect(result).toEqual({
      messageId: MESSAGE_ID,
      attempted: 0,
      persisted: 0,
    });
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
    expect(deleteMetadataKeysMock).toHaveBeenCalledWith({
      messageId: MESSAGE_ID,
      keys: ["unfurls"],
      contentMustEqual: "no urls left",
    });
    expect(mergeMetadataKeysMock).not.toHaveBeenCalled();
    expect(publishByIdMock).toHaveBeenCalledWith(MESSAGE_ID, "unfurl");
  });

  it("does not publish when atomic update matches zero rows", async () => {
    messageFindUniqueMock
      .mockResolvedValueOnce({
        id: MESSAGE_ID,
        content: "check https://example.com/page",
        deletedAt: null,
        editedAt: null,
        metadata: null,
      })
      .mockResolvedValueOnce({
        id: MESSAGE_ID,
        content: "check https://example.com/page",
        deletedAt: null,
      });
    ssrfSafeFetchMock.mockResolvedValue(
      new Response(htmlPage("Page Title"), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    mergeMetadataKeysMock.mockResolvedValue(0);

    const result = await scheduleChatRoomMessageUnfurls(MESSAGE_ID);

    expect(result.persisted).toBe(0);
    expect(publishByIdMock).not.toHaveBeenCalled();
  });

  it("never throws to waitUntil caller on scrape failure", async () => {
    messageFindUniqueMock.mockResolvedValue({
      id: MESSAGE_ID,
      content: "https://example.com",
      deletedAt: null,
      editedAt: null,
      metadata: null,
    });
    ssrfSafeFetchMock.mockRejectedValue(new Error("ssrf boom"));

    await expect(
      scheduleChatRoomMessageUnfurls(MESSAGE_ID),
    ).resolves.toMatchObject({
      messageId: MESSAGE_ID,
      attempted: 1,
      persisted: 0,
    });
  });
});
