import { describe, expect, it } from "vitest";

import { rankSimilarTasks, similarTaskSearchTerms } from "./similar-tasks";

const task = (id: string, name: string) => ({ id, name });

describe("similarTaskSearchTerms", () => {
  it("returns nothing for a brief with fewer than two words to match", () => {
    expect(similarTaskSearchTerms("")).toEqual([]);
    expect(similarTaskSearchTerms("Fix the bug")).toEqual([]);
  });

  it("searches the longest words, cut to a stem, ignoring links and common words", () => {
    expect(
      similarTaskSearchTerms(
        "Write the launch newsletter about pricing https://example.com/very-long-path",
      ),
    ).toEqual(["newsle", "pricin", "launch"]);
  });
});

describe("rankSimilarTasks", () => {
  const brief = "Write the launch newsletter for our new pricing";

  it("keeps Tasks sharing at least two words, most shared first", () => {
    expect(
      rankSimilarTasks(brief, [
        task("a", "Launch newsletter"),
        task("b", "Pricing page copy"),
        task("c", "Newsletter: launch pricing"),
      ]).map((t) => t.id),
    ).toEqual(["c", "a"]);
  });

  it("matches plurals and other endings by shared stem", () => {
    expect(
      rankSimilarTasks("Plan social posts for launches", [
        task("a", "Social post plan"),
      ]).map((t) => t.id),
    ).toEqual(["a"]);
  });

  it("keeps a one-word Task name that matches", () => {
    expect(
      rankSimilarTasks(brief, [task("a", "Newsletter")]).map((t) => t.id),
    ).toEqual(["a"]);
  });

  it("returns each Task once and at most three", () => {
    const tasks = ["a", "b", "c", "d"].map((id) =>
      task(id, "Launch newsletter"),
    );
    expect(
      rankSimilarTasks(brief, [...tasks, tasks[0]]).map((t) => t.id),
    ).toEqual(["a", "b", "c"]);
  });
});
