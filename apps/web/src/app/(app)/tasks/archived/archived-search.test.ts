import { createClient } from "@sokosumi/core-client/client";
import { describe, expect, it } from "vitest";

import {
  ARCHIVED_SEARCH_MAX_LENGTH,
  readArchivedSearch,
} from "./archived-search";

describe("readArchivedSearch", () => {
  it("keeps a search at Core's limit as it is", () => {
    const query = "a".repeat(ARCHIVED_SEARCH_MAX_LENGTH);
    expect(readArchivedSearch(query)).toBe(query);
  });

  it("cuts a longer link search to Core's limit", () => {
    expect(readArchivedSearch("b".repeat(ARCHIVED_SEARCH_MAX_LENGTH + 1))).toBe(
      "b".repeat(ARCHIVED_SEARCH_MAX_LENGTH),
    );
  });

  it("never cuts an emoji in half, so the Core client can encode it", () => {
    const query = readArchivedSearch(`${"a".repeat(199)}😀`);

    expect(query).toBe("a".repeat(199));
    // The generated client encodes q into the GET /tasks URL; half an emoji throws.
    const client = createClient({ baseUrl: "http://core.test" });
    expect(client.buildUrl({ url: "/tasks", query: { q: query } })).toBe(
      `http://core.test/tasks?q=${"a".repeat(199)}`,
    );
  });

  it("keeps an emoji that ends exactly at Core's limit", () => {
    const query = `${"a".repeat(198)}😀`;
    expect(readArchivedSearch(`${query}tail`)).toBe(query);
  });

  it("drops a blank search and reads the first of repeated ones", () => {
    expect(readArchivedSearch("   ")).toBeUndefined();
    expect(readArchivedSearch(undefined)).toBeUndefined();
    expect(readArchivedSearch([" recap ", "other"])).toBe("recap");
  });

  it("trims a space left at the cut", () => {
    const query = `${"c".repeat(ARCHIVED_SEARCH_MAX_LENGTH - 1)} tail`;
    expect(readArchivedSearch(query)).toBe(
      "c".repeat(ARCHIVED_SEARCH_MAX_LENGTH - 1),
    );
  });
});
