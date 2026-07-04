import { describe, expect, it } from "vitest";

import { convertItemsToMessages } from "@/lib/chat/conversation-api-to-ui-messages";

import {
  deduplicateMessagesById,
  extractMessageContent,
  extractReasoningStepMessages,
  getMessageFileParts,
  getThoughtTimingMsFromMessage,
  hasMessageTextOrFileParts,
  mergeAssistantThoughtMetadataFromDb,
  reconcileSlotMessagesWithDb,
} from "../message-utils";

describe("extractMessageContent", () => {
  it("keeps only text parts, not reasoning", () => {
    const message = {
      id: "a1",
      role: "assistant" as const,
      parts: [
        { type: "reasoning" as const, text: "Processing..." },
        { type: "reasoning" as const, text: "Thinking..." },
        { type: "text" as const, text: "Hello world" },
      ],
    };
    expect(extractMessageContent(message)).toBe("Hello world");
  });

  it("returns empty when the assistant message has only reasoning parts", () => {
    const message = {
      id: "a2",
      role: "assistant" as const,
      parts: [{ type: "reasoning" as const, text: "Processing..." }],
    };
    expect(extractMessageContent(message)).toBe("");
  });

  it('does not surface text when part type is missing or not the string "text"', () => {
    expect(
      extractMessageContent({
        id: "a3",
        role: "assistant" as const,
        parts: [{ text: "leak" }],
      }),
    ).toBe("");

    expect(
      extractMessageContent({
        id: "a4",
        role: "assistant" as const,
        parts: [{ type: 1, text: "leak" }],
      } as unknown),
    ).toBe("");
  });

  it('whitelists only type "text" in content array object parts', () => {
    expect(
      extractMessageContent({
        id: "a5",
        role: "assistant" as const,
        content: [{ type: "reasoning" as const, text: "hidden" }],
      }),
    ).toBe("");

    expect(
      extractMessageContent({
        id: "a6",
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "visible" }],
      }),
    ).toBe("visible");
  });
});

describe("hasMessageTextOrFileParts", () => {
  it("returns false for synthetic empty text fallback parts", () => {
    expect(
      hasMessageTextOrFileParts({
        id: "u1",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "" }],
      }),
    ).toBe(false);
  });

  it("returns true for file-only user messages", () => {
    expect(
      hasMessageTextOrFileParts({
        id: "u2",
        role: "user" as const,
        parts: [
          {
            type: "file" as const,
            url: "https://example.com/brief.pdf",
            mediaType: "application/pdf",
            filename: "brief.pdf",
          },
        ],
      }),
    ).toBe(true);
  });

  it("returns true for file-only content arrays", () => {
    expect(
      hasMessageTextOrFileParts({
        id: "u3",
        role: "user" as const,
        content: [
          {
            type: "file" as const,
            url: "https://example.com/image.png",
            mediaType: "image/png",
          },
        ],
      }),
    ).toBe(true);
  });

  it("returns true for file-only assistant image messages", () => {
    expect(
      hasMessageTextOrFileParts({
        id: "a-file",
        role: "assistant" as const,
        parts: [
          {
            type: "file" as const,
            url: "https://example.com/generated.png",
            mediaType: "image/png",
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("getMessageFileParts", () => {
  it("extracts file parts without mixing them into visible text", () => {
    const message = {
      id: "u4",
      role: "user" as const,
      parts: [
        { type: "text" as const, text: "Look at this" },
        {
          type: "file" as const,
          url: "https://example.com/blob.png",
          mediaType: "image/png",
          filename: "blob.png",
        },
      ],
    };

    expect(extractMessageContent(message)).toBe("Look at this");
    expect(getMessageFileParts(message)).toEqual([
      {
        type: "file",
        url: "https://example.com/blob.png",
        mediaType: "image/png",
        filename: "blob.png",
      },
    ]);
  });

  it("dedupes the same file URL when it appears in both array content and parts", () => {
    const url = "https://blob.example.com/generated.png";
    const file = {
      type: "file" as const,
      url,
      mediaType: "image/png" as const,
      filename: "generated.png",
    };
    const message = {
      id: "asst-dup",
      role: "assistant" as const,
      content: [{ type: "output_text" as const, text: "Caption." }, file],
      parts: [{ type: "text" as const, text: "Caption." }, file],
    };

    expect(getMessageFileParts(message)).toEqual([file]);
    expect(hasMessageTextOrFileParts(message)).toBe(true);
  });
});

describe("extractReasoningStepMessages", () => {
  it("lists reasoning parts in order with stable ids", () => {
    const message = {
      id: "mid",
      role: "assistant" as const,
      parts: [
        { type: "reasoning" as const, text: "Processing..." },
        { type: "text" as const, text: "Hi" },
        { type: "reasoning" as const, text: "More thought" },
      ],
    };
    expect(extractReasoningStepMessages(message)).toEqual([
      { id: "mid-reasoning-0", message: "Processing..." },
      { id: "mid-reasoning-1", message: "More thought" },
    ]);
  });

  it("preserves Processing-only placeholder for loader coordination", () => {
    const message = {
      id: "solo",
      role: "assistant" as const,
      parts: [{ type: "reasoning" as const, text: "Processing..." }],
    };
    expect(extractReasoningStepMessages(message)).toEqual([
      { id: "solo-reasoning-0", message: "Processing..." },
    ]);
  });

  it("shows a placeholder for empty streaming reasoning parts", () => {
    const message = {
      id: "streaming",
      role: "assistant" as const,
      parts: [
        {
          type: "reasoning" as const,
          text: "",
          state: "streaming" as const,
        },
      ],
    };
    expect(extractReasoningStepMessages(message)).toEqual([
      { id: "streaming-reasoning-0", message: "Thinking..." },
    ]);
  });

  it("keeps reasoning text exactly except for trimming", () => {
    const message = {
      id: "m2",
      role: "assistant" as const,
      parts: [
        {
          type: "reasoning" as const,
          text: "Thinking...I will check the facts first.",
        },
      ],
    };
    expect(extractReasoningStepMessages(message)).toEqual([
      {
        id: "m2-reasoning-0",
        message: "Thinking...I will check the facts first.",
      },
    ]);
  });

  it("extracts only thought from JSON reasoning parts", () => {
    const message = {
      id: "json-thought",
      role: "assistant" as const,
      parts: [
        {
          type: "reasoning" as const,
          text: JSON.stringify({
            action: "dalle.text2im",
            action_input: JSON.stringify({ prompt: "Cyberpunk city" }),
            thought: "I will generate the requested cyberpunk city image.",
          }),
        },
      ],
    };
    expect(extractReasoningStepMessages(message)).toEqual([
      {
        id: "json-thought-reasoning-0",
        message: "I will generate the requested cyberpunk city image.",
      },
    ]);
  });
});

describe("getThoughtTimingMsFromMessage", () => {
  it("returns nulls when metadata is absent", () => {
    expect(getThoughtTimingMsFromMessage({ role: "assistant" })).toEqual({
      startedAtMs: null,
      endedAtMs: null,
    });
  });

  it("reads persisted thought timestamps from metadata", () => {
    expect(
      getThoughtTimingMsFromMessage({
        metadata: {
          thoughtStartedAtMs: 1_700_000_000_000,
          thoughtEndedAtMs: 1_700_000_012_000,
        },
      }),
    ).toEqual({
      startedAtMs: 1_700_000_000_000,
      endedAtMs: 1_700_000_012_000,
    });
  });

  it("reads thought_timing_ms from metadata when camelCase is absent", () => {
    expect(
      getThoughtTimingMsFromMessage({
        metadata: {
          thought_timing_ms: { start: 100, end: 200 },
        },
      }),
    ).toEqual({
      startedAtMs: 100,
      endedAtMs: 200,
    });
  });
});

describe("reconcileSlotMessagesWithDb", () => {
  it("replaces empty slot assistant tail with db content", () => {
    const slot = [
      {
        id: "user-1",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "Hi" }],
      },
      {
        id: "asst-1",
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: "" }],
      },
    ];
    const db = convertItemsToMessages([
      {
        id: "user-1",
        role: "user",
        createdAt: 1700000000,
        content: [{ type: "input_text", text: "Hi" }],
      },
      {
        id: "asst-1",
        role: "assistant",
        createdAt: 1700000001,
        content: [{ type: "output_text", text: "Hello from DB" }],
      },
    ]);
    const merged = reconcileSlotMessagesWithDb(slot, db);
    expect(extractMessageContent(merged[1] ?? {})).toBe("Hello from DB");
  });

  it("replaces agent-error slot tail when db has a real reply", () => {
    const slot = [
      {
        id: "asst-1",
        role: "assistant" as const,
        parts: [
          {
            type: "text" as const,
            text: "Something went wrong while processing your task. Please try again.",
          },
        ],
      },
    ];
    const db = convertItemsToMessages([
      {
        id: "asst-1",
        role: "assistant",
        createdAt: 1700000001,
        content: [{ type: "output_text", text: "Task created successfully." }],
      },
    ]);
    const merged = reconcileSlotMessagesWithDb(slot, db);
    expect(extractMessageContent(merged[0] ?? {})).toBe(
      "Task created successfully.",
    );
  });
});

describe("mergeAssistantThoughtMetadataFromDb", () => {
  it("merges thought timing from DB messages onto slot messages by id", () => {
    const slot = [
      {
        id: "asst-1",
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: "Hi" }],
      },
    ];
    const db = convertItemsToMessages([
      {
        id: "asst-1",
        role: "assistant",
        createdAt: 1700000000,
        content: [{ type: "output_text", text: "Hi" }],
        thoughtTiming: { startedAtMs: 10, endedAtMs: 50 },
      },
    ]);
    const merged = mergeAssistantThoughtMetadataFromDb(slot, db);
    expect(merged[0]).toMatchObject({
      id: "asst-1",
      metadata: { thoughtStartedAtMs: 10, thoughtEndedAtMs: 50 },
    });
  });
});

describe("deduplicateMessagesById", () => {
  it("keeps every message when ids are missing (no empty-key collapse)", () => {
    const messages: Array<{ id?: string; role: string }> = [
      { role: "user" },
      { role: "assistant" },
      { role: "user" },
    ];
    expect(deduplicateMessagesById(messages)).toEqual(messages);
  });

  it("keeps first only when duplicate non-empty ids", () => {
    const a = { id: "m1", text: "first" };
    const b = { id: "m1", text: "dup" };
    const c = { id: "m2", text: "other" };
    expect(deduplicateMessagesById([a, b, c])).toEqual([a, c]);
  });

  it("treats whitespace-only id as absent for deduplication", () => {
    const messages: Array<{ id?: string; role?: string }> = [
      { id: "   " },
      { id: "\t" },
      { role: "x" },
    ];
    expect(deduplicateMessagesById(messages)).toEqual(messages);
  });

  it("trims ids before comparing", () => {
    const a = { id: "  same  " };
    const b = { id: "same" };
    expect(deduplicateMessagesById([a, b])).toEqual([a]);
  });
});
