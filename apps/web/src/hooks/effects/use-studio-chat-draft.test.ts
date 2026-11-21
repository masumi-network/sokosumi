import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStudioChatDraft } from "./use-studio-chat-draft";

describe("useStudioChatDraft", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("restores a persisted draft for the project and persists updates", () => {
    window.sessionStorage.setItem(
      "sokosumi:image-studio:draft:proj-1",
      "Make it warmer",
    );

    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) => useStudioChatDraft(projectId),
      { initialProps: { projectId: "proj-1" } },
    );

    expect(result.current.draft).toBe("Make it warmer");
    expect(result.current.draftRef.current).toBe("Make it warmer");

    act(() => {
      result.current.handleDraftChange("Brighter background");
    });

    expect(result.current.draft).toBe("Brighter background");
    expect(
      window.sessionStorage.getItem("sokosumi:image-studio:draft:proj-1"),
    ).toBe("Brighter background");

    // Switching projects restores the new project's saved draft.
    window.sessionStorage.setItem(
      "sokosumi:image-studio:draft:proj-2",
      "Second project draft",
    );
    rerender({ projectId: "proj-2" });
    expect(result.current.draft).toBe("Second project draft");
  });

  it("restores a failed message only when the composer is still empty", () => {
    const { result } = renderHook(() => useStudioChatDraft("proj-1"));

    act(() => {
      result.current.restoreFailedMessage("Failed prompt");
    });
    expect(result.current.draft).toBe("Failed prompt");
    expect(
      window.sessionStorage.getItem("sokosumi:image-studio:draft:proj-1"),
    ).toBe("Failed prompt");

    // Does not overwrite newer text already in the box.
    act(() => {
      result.current.restoreFailedMessage("Older failed prompt");
    });
    expect(result.current.draft).toBe("Failed prompt");
  });

  it("survives sessionStorage errors without throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    const { result } = renderHook(() => useStudioChatDraft("proj-1"));
    expect(result.current.draft).toBe("");

    act(() => {
      result.current.handleDraftChange("Still works");
    });
    expect(result.current.draft).toBe("Still works");
  });
});
