import { describe, expect, it } from "vitest";

import { projectSummaryFromLoadedRelation } from "./loaded-relation-summaries";

describe("projectSummaryFromLoadedRelation", () => {
  it("returns null when projectId is null", () => {
    expect(
      projectSummaryFromLoadedRelation("Task tsk_1", null, null),
    ).toBeNull();
  });

  it("maps a loaded project to id, name, and logo", () => {
    expect(
      projectSummaryFromLoadedRelation(
        "Task tsk_1",
        "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        {
          id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          name: "Autumn",
          logo: "https://example.com/logo.png",
        },
      ),
    ).toEqual({
      id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      name: "Autumn",
      logo: "https://example.com/logo.png",
    });
  });

  it("throws when projectId is set but the relation is missing", () => {
    expect(() =>
      projectSummaryFromLoadedRelation(
        "Task tsk_1",
        "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        null,
      ),
    ).toThrow(
      "Task tsk_1: project relation must be loaded for API mapping (projectId=aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa).",
    );
  });
});
