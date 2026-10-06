import { describe, expect, it } from "vitest";
import { publicChatRoomMessageMetadata } from "./chat-room-message-unfurl-metadata";

describe("public result metadata", () => {
  it("never broadcasts private snapshots or their resource references", () => {
    expect(
      publicChatRoomMessageMetadata({
        ordinary: "kept",
        result_preview_snapshots: [
          {
            reference: { kind: "file", id: "private-file" },
            data: { title: "Confidential report" },
          },
        ],
      }),
    ).toEqual({ ordinary: "kept" });
  });
});
