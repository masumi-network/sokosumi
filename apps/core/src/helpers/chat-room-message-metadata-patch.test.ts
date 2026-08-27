import { beforeEach, describe, expect, it, vi } from "vitest";

const executeRawMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $executeRaw: (...args: unknown[]) => executeRawMock(...args),
  },
}));

import {
  deleteChatRoomMessageMetadataKeys,
  mergeChatRoomMessageMetadataKeys,
} from "./chat-room-message-metadata-patch";

function sqlPartsFromCall(call: unknown[]): string {
  // Tagged template → (strings, ...values) or Prisma.Sql object.
  const first = call[0];
  if (first && typeof first === "object" && "strings" in first) {
    const strings = (first as { strings: readonly string[] }).strings;
    return strings.join("?");
  }
  if (Array.isArray(first)) {
    return first.join("?");
  }
  return String(first);
}

describe("mergeChatRoomMessageMetadataKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeRawMock.mockResolvedValue(1);
  });

  it("issues jsonb || merge with soft-delete + content guards", async () => {
    const updated = await mergeChatRoomMessageMetadataKeys({
      messageId: "550e8400-e29b-41d4-a716-446655440001",
      patch: { unfurls: [{ url: "https://example.com" }] },
      contentMustEqual: "check https://example.com",
    });

    expect(updated).toBe(1);
    expect(executeRawMock).toHaveBeenCalledTimes(1);
    const sqlText = sqlPartsFromCall(executeRawMock.mock.calls[0] ?? []);
    expect(sqlText).toContain("COALESCE(metadata, '{}'::jsonb)");
    expect(sqlText).toContain("::jsonb");
    expect(sqlText).toContain('"deletedAt" IS NULL');
    expect(sqlText).toContain("content =");
  });

  it("issues jsonb || merge without content guard for thread conversation writes", async () => {
    await mergeChatRoomMessageMetadataKeys({
      messageId: "550e8400-e29b-41d4-a716-446655440002",
      patch: { thread_provider_conversation_id: "conv_1" },
      requireNotDeleted: false,
    });

    const sqlText = sqlPartsFromCall(executeRawMock.mock.calls[0] ?? []);
    expect(sqlText).toContain("COALESCE(metadata, '{}'::jsonb)");
    expect(sqlText).not.toContain('"deletedAt" IS NULL');
    expect(sqlText).not.toContain("content =");
  });
});

describe("deleteChatRoomMessageMetadataKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeRawMock.mockResolvedValue(1);
  });

  it("no-ops when keys is empty", async () => {
    const updated = await deleteChatRoomMessageMetadataKeys({
      messageId: "550e8400-e29b-41d4-a716-446655440001",
      keys: [],
    });
    expect(updated).toBe(0);
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it("issues jsonb - text[] delete with soft-delete + content guards", async () => {
    await deleteChatRoomMessageMetadataKeys({
      messageId: "550e8400-e29b-41d4-a716-446655440001",
      keys: ["unfurls"],
      contentMustEqual: "no urls left",
    });

    const sqlText = sqlPartsFromCall(executeRawMock.mock.calls[0] ?? []);
    expect(sqlText).toContain("NULLIF");
    expect(sqlText).toContain("::text[]");
    expect(sqlText).toContain('"deletedAt" IS NULL');
    expect(sqlText).toContain("content =");
  });
});
