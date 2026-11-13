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
