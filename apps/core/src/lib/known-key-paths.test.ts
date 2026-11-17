import { describe, expect, it } from "vitest";

import { knownKeyPaths } from "./known-key-paths";

describe("knownKeyPaths", () => {
  it("names known paths and only counts the other keys", () => {
    expect(
      knownKeyPaths(
        { data: { id: 1, "Ada private plan": { id: 2 } }, other: true },
        new Set(["data", "id"]),
        5,
      ),
    ).toEqual({ keyPaths: ["data", "data.id"], otherKeys: 2 });
  });

  it("stops at the depth limit", () => {
    expect(
      knownKeyPaths({ data: { data: { data: {} } } }, new Set(["data"]), 1),
    ).toEqual({ keyPaths: ["data", "data.data"], otherKeys: 0 });
  });
});
