import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/projects/[projectId]/components/record-project-visit", () => ({
  RecordProjectVisit: () => null,
}));

import * as layout from "@/app/projects/[projectId]/layout";

describe("project layout", () => {
  // A title here, even a plain one, replaces the app's "Sokosumi - %s"
  // template for every project page below it: each page titles itself.
  it("sets no title of its own", () => {
    expect("generateMetadata" in layout).toBe(false);
    expect("metadata" in layout).toBe(false);
  });
});
