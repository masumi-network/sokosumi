import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearComposeDraft,
  composeDraftKey,
  getComposeDraft,
  setComposeDraft,
} from "./compose-draft-storage";

describe("compose-draft-storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("builds surface keys", () => {
    expect(composeDraftKey.room("room-1")).toBe(
      "sokosumi:compose-draft:v1:room:room-1",
    );
    expect(composeDraftKey.thread("room-1", "msg-2")).toBe(
      "sokosumi:compose-draft:v1:thread:room-1:msg-2",
    );
    expect(composeDraftKey.draftDm()).toBe(
      "sokosumi:compose-draft:v1:draft-dm",
    );
    expect("welcome" in composeDraftKey).toBe(false);
  });

  it("roundtrips text and attachments", () => {
    const key = composeDraftKey.room("room-1");
    setComposeDraft(key, {
      text: "hello",
      attachments: [
        {
          url: "https://cdn.example/a.png",
          fileName: "a.png",
          mediaType: "image/png",
        },
      ],
    });

    expect(getComposeDraft(key)).toEqual({
      text: "hello",
      attachments: [
        {
          url: "https://cdn.example/a.png",
          fileName: "a.png",
          mediaType: "image/png",
        },
      ],
    });
  });

  it("removes the key when draft is empty", () => {
    const key = composeDraftKey.draftDm();
    setComposeDraft(key, { text: "keep", attachments: [] });
    expect(window.localStorage.getItem(key)).not.toBeNull();

    setComposeDraft(key, { text: "  ", attachments: [] });
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(getComposeDraft(key)).toBeNull();
  });

  it("clearComposeDraft removes the key", () => {
    const key = composeDraftKey.draftDm();
    setComposeDraft(key, { text: "draft", attachments: [] });
    clearComposeDraft(key);
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("does not migrate leftover chat-input into any draft key", () => {
    const leftover = JSON.stringify("legacy text");
    window.localStorage.setItem("chat-input", leftover);

    expect(getComposeDraft(composeDraftKey.draftDm())).toBeNull();
    expect(getComposeDraft("sokosumi:compose-draft:v1:welcome")).toBeNull();
    expect(window.localStorage.getItem("chat-input")).toBe(leftover);
  });

  it("returns null for corrupt JSON", () => {
    const key = composeDraftKey.room("room-1");
    window.localStorage.setItem(key, "{not-json");
    expect(getComposeDraft(key)).toBeNull();
  });

  it("returns null for invalid draft shape", () => {
    const key = composeDraftKey.room("room-1");
    window.localStorage.setItem(
      key,
      JSON.stringify({ text: 1, attachments: [] }),
    );
    expect(getComposeDraft(key)).toBeNull();
  });

  it("soft-fails when localStorage throws", () => {
    const key = composeDraftKey.room("room-1");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(getComposeDraft(key)).toBeNull();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() =>
      setComposeDraft(key, { text: "x", attachments: [] }),
    ).not.toThrow();

    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => clearComposeDraft(key)).not.toThrow();
  });
});
