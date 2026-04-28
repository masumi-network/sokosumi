import { validateUIMessages } from "ai";
import { describe, expect, it } from "vitest";

import { conversationMessagesToUiMessages } from "../conversation-messages-to-ui-messages";

describe("conversationMessagesToUiMessages", () => {
  it("rehydrates stored text and file ui parts from metadata", async () => {
    const messages = conversationMessagesToUiMessages([
      {
        id: "m1",
        role: "user",
        contentText: "Please review this file",
        metadata: {
          ui_message_v1: {
            parts: [
              { type: "text", text: "Please review this file" },
              {
                type: "file",
                url: "https://example.com/brief.pdf",
                mediaType: "application/pdf",
                filename: "brief.pdf",
              },
            ],
          },
        },
      },
    ]);

    expect(messages[0]?.parts).toEqual([
      { type: "text", text: "Please review this file" },
      {
        type: "file",
        url: "https://example.com/brief.pdf",
        mediaType: "application/pdf",
        filename: "brief.pdf",
      },
    ]);

    await expect(validateUIMessages({ messages })).resolves.toBeDefined();
  });

  it("rehydrates file-only metadata without a trailing empty text part", async () => {
    const messages = conversationMessagesToUiMessages([
      {
        id: "m1",
        role: "user",
        contentText: "",
        metadata: {
          ui_message_v1: {
            parts: [
              {
                type: "file",
                url: "https://example.com/brief.pdf",
                mediaType: "application/pdf",
                filename: "brief.pdf",
              },
            ],
          },
        },
      },
    ]);

    expect(messages[0]?.parts).toEqual([
      {
        type: "file",
        url: "https://example.com/brief.pdf",
        mediaType: "application/pdf",
        filename: "brief.pdf",
      },
    ]);

    await expect(validateUIMessages({ messages })).resolves.toBeDefined();
  });

  it("strips reasoning metadata from user messages (parity with mapChatRequestToUiMessages)", async () => {
    const messages = conversationMessagesToUiMessages([
      {
        id: "m1",
        role: "user",
        contentText: "Hi",
        metadata: {
          reasoning: [{ type: "reasoning", text: "corrupt or migrated" }],
          ui_message_v1: {
            parts: [{ type: "text", text: "Hi" }],
          },
        },
      },
    ]);

    expect(messages[0]?.parts).toEqual([{ type: "text", text: "Hi" }]);
    await expect(validateUIMessages({ messages })).resolves.toBeDefined();
  });
});
