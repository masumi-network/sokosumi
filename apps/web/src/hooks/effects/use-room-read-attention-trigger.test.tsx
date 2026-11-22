import type { ChatRoom } from "@sokosumi/core-client";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  type RoomReadAttentionTriggerOptions,
  useRoomReadAttentionTrigger,
} from "./use-room-read-attention-trigger";

function Probe({
  options,
  readCurrentRoom,
}: {
  options: RoomReadAttentionTriggerOptions;
  readCurrentRoom: () => Promise<void>;
}) {
  useRoomReadAttentionTrigger(options, readCurrentRoom);
  return null;
}

describe("useRoomReadAttentionTrigger", () => {
  it("runs readCurrentRoom on mount and whenever tracked read-attention inputs change", () => {
    const readCurrentRoom = vi.fn(async () => {});
    const messages = [{ id: "m1", content: "hello" }];
    const threadMessages: { id: string; content: string }[] = [];
    const base: RoomReadAttentionTriggerOptions = {
      room: { id: "r1" } as ChatRoom,
      messages,
      openThreadParentId: null,
      threadMessages,
      messagesPending: false,
      messageLoadFailed: false,
      isThreadLoading: false,
      transcriptAtEnd: true,
    };

    const { rerender, unmount } = render(
      <Probe options={base} readCurrentRoom={readCurrentRoom} />,
    );
    expect(readCurrentRoom).toHaveBeenCalledTimes(1);

    // Same tracked values on a new options wrapper do not re-trigger.
    rerender(<Probe options={{ ...base }} readCurrentRoom={readCurrentRoom} />);
    expect(readCurrentRoom).toHaveBeenCalledTimes(1);

    // Changing a tracked field triggers another read.
    rerender(
      <Probe
        options={{ ...base, transcriptAtEnd: false }}
        readCurrentRoom={readCurrentRoom}
      />,
    );
    expect(readCurrentRoom).toHaveBeenCalledTimes(2);

    unmount();
  });
});
