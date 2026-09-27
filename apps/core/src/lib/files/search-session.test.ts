import { describe, expect, it } from "vitest";

import {
  buildSearchBindingDigest,
  decodeSearchCursor,
  encodeSearchCursor,
  takeWindowPage,
  type WindowEntry,
} from "./search-session";

const SECRET = "test-cursor-secret";

function entry(id: string, content = 1, metadata = 1): WindowEntry {
  return { r: id, c: content, m: metadata };
}

function live(
  ids: [string, number, number][],
): Map<string, { contentRevision: number; metadataRevision: number }> {
  return new Map(
    ids.map(([id, content, metadata]) => [
      id,
      { contentRevision: content, metadataRevision: metadata },
    ]),
  );
}

describe("search cursor", () => {
  it("round-trips a signed position", () => {
    const cursor = encodeSearchCursor({ v: 1, w: "window-1", p: 22 }, SECRET);
    expect(decodeSearchCursor(cursor, SECRET)).toEqual({
      v: 1,
      w: "window-1",
      p: 22,
    });
  });

  it("rejects a cursor signed with another secret", () => {
    const cursor = encodeSearchCursor({ v: 1, w: "window-1", p: 0 }, SECRET);
    expect(() => decodeSearchCursor(cursor, "other-secret")).toThrow();
  });

  it("rejects a tampered position", () => {
    const cursor = encodeSearchCursor({ v: 1, w: "window-1", p: 0 }, SECRET);
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString());
    decoded.payload = decoded.payload.replace('"p":0', '"p":99');
    const tampered = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    expect(() => decodeSearchCursor(tampered, SECRET)).toThrow();
  });
});

describe("buildSearchBindingDigest", () => {
  it("changes when the sort changes, so an old cursor restarts", () => {
    const base = {
      query: "aurora",
      filters: {},
      sortOrder: "desc" as const,
      indexGeneration: 1,
    };
    expect(buildSearchBindingDigest({ ...base, sortBy: "relevance" })).not.toBe(
      buildSearchBindingDigest({ ...base, sortBy: "modified" }),
    );
  });

  it("is stable across filter key order", () => {
    const left = buildSearchBindingDigest({
      query: "a",
      filters: { tagLabelIds: ["t1"], projectIds: ["p1"] },
      sortBy: "relevance",
      sortOrder: "desc",
      indexGeneration: 1,
    });
    const right = buildSearchBindingDigest({
      query: "a",
      filters: { projectIds: ["p1"], tagLabelIds: ["t1"] },
      sortBy: "relevance",
      sortOrder: "desc",
      indexGeneration: 1,
    });
    expect(left).toBe(right);
  });
});

describe("takeWindowPage", () => {
  it("advances over every scanned position, not over returned items", () => {
    const entries = [entry("a"), entry("b", 2), entry("c"), entry("d")];
    const page = takeWindowPage({
      entries,
      from: 0,
      limit: 2,
      current: live([
        ["a", 1, 1],
        // b moved on to content revision 3, so it drops out of this order
        ["b", 3, 1],
        ["c", 1, 1],
        ["d", 1, 1],
      ]),
    });

    expect(page.resourceIds).toEqual(["a", "c"]);
    expect(page.nextPosition).toBe(3);
    expect(page.omitted).toBe(1);
    expect(page.hasMore).toBe(true);
  });

  it("omits a deleted entry rather than substituting another", () => {
    const entries = [entry("a"), entry("gone"), entry("c")];
    const page = takeWindowPage({
      entries,
      from: 0,
      limit: 3,
      current: live([
        ["a", 1, 1],
        ["c", 1, 1],
      ]),
    });
    expect(page.resourceIds).toEqual(["a", "c"]);
    expect(page.nextPosition).toBe(3);
    expect(page.hasMore).toBe(false);
  });

  it("can return a short page when later positions all changed", () => {
    const entries = [entry("a"), entry("b"), entry("c")];
    const page = takeWindowPage({
      entries,
      from: 1,
      limit: 5,
      current: live([["a", 1, 1]]),
    });
    expect(page.resourceIds).toEqual([]);
    expect(page.nextPosition).toBe(3);
    expect(page.hasMore).toBe(false);
  });

  it("treats a metadata revision change as a changed entry", () => {
    const page = takeWindowPage({
      entries: [entry("a", 1, 1)],
      from: 0,
      limit: 5,
      current: live([["a", 1, 2]]),
    });
    expect(page.resourceIds).toEqual([]);
    expect(page.omitted).toBe(1);
  });

  it("never returns a duplicate across consecutive pages", () => {
    const entries = [entry("a"), entry("b"), entry("c"), entry("d")];
    const current = live([
      ["a", 1, 1],
      ["b", 1, 1],
      ["c", 1, 1],
      ["d", 1, 1],
    ]);
    const first = takeWindowPage({ entries, from: 0, limit: 2, current });
    const second = takeWindowPage({
      entries,
      from: first.nextPosition,
      limit: 2,
      current,
    });
    expect(first.resourceIds).toEqual(["a", "b"]);
    expect(second.resourceIds).toEqual(["c", "d"]);
    expect(second.hasMore).toBe(false);
  });
});

describe("paging past entries the caller did not fetch", () => {
  /**
   * Absence from `current` used to mean the same thing whether a resource
   * had been looked up and found gone, or never looked up at all. The
   * caller prefetches a bounded slice, so once more than that slice's slack
   * had genuinely dropped out, the walk ran on into unfetched territory and
   * counted **live** files as missing — then moved the cursor past them, so
   * they never came back on a later page.
   */
  function entriesFor(count: number): WindowEntry[] {
    return Array.from({ length: count }, (_, index) => ({
      r: `resource-${index}`,
      c: 1,
      m: 1,
    }));
  }

  it("stops at the end of what was fetched instead of inventing omissions", () => {
    const entries = entriesFor(50);
    // Only the first five were looked up; they are all alive.
    const current = new Map(
      entries
        .slice(0, 5)
        .map((entry) => [entry.r, { contentRevision: 1, metadataRevision: 1 }]),
    );

    const page = takeWindowPage({
      entries,
      from: 0,
      limit: 20,
      current,
      available: 5,
    });

    expect(page.resourceIds).toHaveLength(5);
    // Crucially: nothing was declared omitted, and the cursor did not run
    // past the five we actually know about.
    expect(page.omitted).toBe(0);
    expect(page.nextPosition).toBe(5);
    expect(page.hasMore).toBe(true);
  });

  it("still omits an entry that was fetched and has moved", () => {
    const entries = entriesFor(4);
    const current = new Map(
      entries.map((entry) => [
        entry.r,
        entry.r === "resource-1"
          ? { contentRevision: 2, metadataRevision: 1 }
          : { contentRevision: 1, metadataRevision: 1 },
      ]),
    );

    const page = takeWindowPage({
      entries,
      from: 0,
      limit: 10,
      current,
      available: 4,
    });

    expect(page.resourceIds).toEqual([
      "resource-0",
      "resource-2",
      "resource-3",
    ]);
    expect(page.omitted).toBe(1);
  });

  it("treats a fetched-but-absent entry as gone, as before", () => {
    const entries = entriesFor(3);
    const current = new Map([
      ["resource-0", { contentRevision: 1, metadataRevision: 1 }],
      ["resource-2", { contentRevision: 1, metadataRevision: 1 }],
    ]);

    const page = takeWindowPage({
      entries,
      from: 0,
      limit: 10,
      current,
      available: 3,
    });

    expect(page.resourceIds).toEqual(["resource-0", "resource-2"]);
    expect(page.omitted).toBe(1);
    expect(page.nextPosition).toBe(3);
  });

  it("behaves as it always did when the caller vouches for everything", () => {
    const entries = entriesFor(3);
    const current = new Map(
      entries.map((entry) => [
        entry.r,
        { contentRevision: 1, metadataRevision: 1 },
      ]),
    );

    // No `available`: the caller is saying the map covers the whole window.
    const page = takeWindowPage({ entries, from: 0, limit: 10, current });

    expect(page.resourceIds).toHaveLength(3);
    expect(page.hasMore).toBe(false);
  });
});
