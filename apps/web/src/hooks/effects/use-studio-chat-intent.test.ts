import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useStudioChatIntent } from "./use-studio-chat-intent";

describe("useStudioChatIntent", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("hydrates an in-flight intent when not resuming a session and skips when resuming", () => {
    window.sessionStorage.setItem(
      "sokosumi:image-studio:intent:proj-1",
      JSON.stringify({
        id: "intent-1",
        says: JSON.stringify(["Hello", "asset-1", "extra-ignored"]),
      }),
    );

    const { result: fresh } = renderHook(() =>
      useStudioChatIntent("proj-1", null),
    );
    expect(fresh.current.intentRef.current).toEqual({
      id: "intent-1",
      says: JSON.stringify(["Hello", "asset-1"]),
    });

    const { result: resumed } = renderHook(() =>
      useStudioChatIntent("proj-1", "session-123"),
    );
    expect(resumed.current.intentRef.current).toBeNull();
  });

  it("claims a new intent once and removes it on release", () => {
    const { result } = renderHook(() => useStudioChatIntent("proj-1", null));

    const says = JSON.stringify(["Create banner", null]);
    result.current.claimIntent(says);
    const claimed = result.current.intentRef.current;
    expect(claimed).not.toBeNull();
    expect(claimed?.says).toBe(says);
    expect(
      window.sessionStorage.getItem("sokosumi:image-studio:intent:proj-1"),
    ).toBe(JSON.stringify(claimed));

    // A second claim while active is a no-op.
    result.current.claimIntent(JSON.stringify(["Different", null]));
    expect(result.current.intentRef.current).toBe(claimed);

    result.current.releaseIntent();
    expect(result.current.intentRef.current).toBeNull();
    expect(
      window.sessionStorage.getItem("sokosumi:image-studio:intent:proj-1"),
    ).toBeNull();
  });
});
