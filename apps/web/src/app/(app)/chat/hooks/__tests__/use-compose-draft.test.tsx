import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  composeDraftKey,
  getComposeDraft,
  setComposeDraft,
} from "@/app/chat/utils/compose-draft-storage";

import { usePersistComposeDraft } from "../use-compose-draft";

describe("usePersistComposeDraft", () => {
  const key = composeDraftKey.room("room-clear-test");

  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("clears persisted draft and does not rewrite it after clearDraft", () => {
    setComposeDraft(key, { text: "about to send", attachments: [] });

    let hydratedText = "";
    const { result, rerender, unmount } = renderHook(
      ({ draft }) =>
        usePersistComposeDraft({
          key,
          draft,
          onHydrate: (next) => {
            hydratedText = next.text;
          },
          debounceMs: 300,
        }),
      {
        initialProps: {
          draft: { text: "about to send", attachments: [] as [] },
        },
      },
    );

    expect(hydratedText).toBe("about to send");

    act(() => {
      result.current.clearDraft();
    });

    rerender({ draft: { text: "", attachments: [] } });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(getComposeDraft(key)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();

    unmount();
    expect(getComposeDraft(key)).toBeNull();
  });

  it("does not flush a pending typed draft after clearDraft on unmount", () => {
    const { result, rerender, unmount } = renderHook(
      ({ draft }) =>
        usePersistComposeDraft({
          key,
          draft,
          onHydrate: () => {},
          debounceMs: 300,
        }),
      {
        initialProps: {
          draft: { text: "", attachments: [] as [] },
        },
      },
    );

    rerender({ draft: { text: "typing indicators please", attachments: [] } });

    act(() => {
      result.current.clearDraft();
    });

    rerender({ draft: { text: "", attachments: [] } });
    unmount();

    expect(getComposeDraft(key)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("persists typed draft after debounce when not cleared", () => {
    const { rerender } = renderHook(
      ({ draft }) =>
        usePersistComposeDraft({
          key,
          draft,
          onHydrate: () => {},
          debounceMs: 300,
        }),
      {
        initialProps: {
          draft: { text: "", attachments: [] as [] },
        },
      },
    );

    // Skip the mount hydrate persist-skip, then type.
    rerender({ draft: { text: "", attachments: [] } });
    rerender({ draft: { text: "keep me", attachments: [] } });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(getComposeDraft(key)?.text).toBe("keep me");
  });

  it("flushPending after navigate must not resurrect a cleared draft", () => {
    const keyA = composeDraftKey.room("room-a");
    const keyB = composeDraftKey.room("room-b");

    const { result, rerender, unmount } = renderHook(
      ({ draft, draftKey }) =>
        usePersistComposeDraft({
          key: draftKey,
          draft,
          onHydrate: () => {},
          debounceMs: 300,
        }),
      {
        initialProps: {
          draft: { text: "typing indicators please", attachments: [] as [] },
          draftKey: keyA,
        },
      },
    );

    act(() => {
      result.current.clearDraft();
    });
    rerender({
      draft: { text: "", attachments: [] },
      draftKey: keyB,
    });
    unmount();

    expect(getComposeDraft(keyA)).toBeNull();
    expect(window.localStorage.getItem(keyA)).toBeNull();
  });
});
