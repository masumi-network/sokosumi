import { describe, expect, it } from "vitest";

import { resolveSeoIndexingAuditPageUrl } from "./seo-task-indexing-context";

const PRIMARY = "https://example.test/primary";
const SUCCESSFUL = "https://example.test/successful";
const SEEDS = [PRIMARY, SUCCESSFUL];

describe("indexing assessment parent selection", () => {
  it("defaults legacy requests to the original primary page", () => {
    expect(resolveSeoIndexingAuditPageUrl(SEEDS)).toBe(PRIMARY);
  });

  it("uses a successful original seed when the primary audit was skipped", () => {
    expect(resolveSeoIndexingAuditPageUrl(SEEDS, SUCCESSFUL)).toBe(SUCCESSFUL);
  });

  it.each(["https://example.test/related", "https://other.test/primary"])(
    "rejects a forged evidence parent outside original audit seeds: %s",
    (hint) => {
      expect(() => resolveSeoIndexingAuditPageUrl(SEEDS, hint)).toThrow(
        "approved audit page",
      );
    },
  );
});
