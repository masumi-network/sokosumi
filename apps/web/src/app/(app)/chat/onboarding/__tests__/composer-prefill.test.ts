import { beforeEach, describe, expect, it } from "vitest";

import {
  peekRoomComposerPrefill,
  stashRoomComposerPrefill,
  takeRoomComposerPrefill,
} from "../composer-prefill";

describe("room composer prefill", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("stashes and takes once", () => {
    stashRoomComposerPrefill("room-1", "  hello draft  ");
    expect(peekRoomComposerPrefill("room-1")).toBe("hello draft");
    expect(takeRoomComposerPrefill("room-1")).toBe("hello draft");
    expect(takeRoomComposerPrefill("room-1")).toBeNull();
    expect(peekRoomComposerPrefill("room-1")).toBeNull();
  });

  it("uses a key prefix distinct from auto-send pending", () => {
    stashRoomComposerPrefill("room-2", "prefill");
    expect(sessionStorage.getItem("pending-room-composer-draft:room-2")).toBe(
      "prefill",
    );
    expect(
      sessionStorage.getItem("chat-room-pending-message:room-2"),
    ).toBeNull();
  });

  it("ignores empty text", () => {
    stashRoomComposerPrefill("room-3", "   ");
    expect(takeRoomComposerPrefill("room-3")).toBeNull();
  });
});
