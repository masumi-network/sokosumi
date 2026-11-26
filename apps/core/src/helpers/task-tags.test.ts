import { describe, expect, it } from "vitest";
import { mapTaskTags, parseTaskTagAnswers, TASK_TAG_IDS } from "./task-tags";

describe("stored task tags", () => {
  // Tags are automatic now and nothing writes these two columns any more, but rows
  // a user corrected while the editor existed keep their choices and keep winning.
  it("still prefers legacy manual choices and suppresses legacy rejections", () => {
    expect(
      mapTaskTags({
        manualTags: ["writing", "research"],
        rejectedTags: ["social"],
        automaticTags: ["social", "research", "marketing"],
      }),
    ).toEqual({
      manual: ["writing", "research"],
      rejected: ["social"],
      automatic: ["marketing"],
    });
  });
  it("bounds visible tags and filters unknown persisted IDs", () => {
    expect(
      mapTaskTags({
        manualTags: ["research", "writing", "strategy", "design", "analysis"],
        automaticTags: ["social", "bogus"],
      }).automatic,
    ).toEqual([]);
  });
  // An edit moves the automatic tags to previousAutomaticTags and requeues.
  it.each([
    ["pending", ["research"]],
    ["running", ["research"]],
    ["complete", []],
    // Retries exhausted: the old tags no longer stand in for current ones.
    ["failed", []],
  ])(
    "shows previous automatic tags as checking only while %s",
    (tagClassificationState, shown) => {
      const tags = mapTaskTags({
        automaticTags: [],
        previousAutomaticTags: ["research", "social"],
        rejectedTags: ["social"],
        tagClassificationState,
      });
      expect(tags.automatic).toEqual(shown);
      expect(tags.checking).toBe(shown.length ? true : undefined);
    },
  );
  it("prefers current automatic tags over previous ones", () => {
    expect(
      mapTaskTags({
        automaticTags: ["writing"],
        previousAutomaticTags: ["research"],
        tagClassificationState: "pending",
      }),
    ).toEqual({ automatic: ["writing"], manual: [], rejected: [] });
  });
});
describe("Jev answer validation", () => {
  const answers = () =>
    Object.fromEntries(
      TASK_TAG_IDS.map((id) => [id, { type: "boolean", probability: 0.1 }]),
    );
  it("abstains on uncertainty and accepts only confident vocabulary IDs", () => {
    const input = answers();
    input.research.probability = 0.9;
    expect(parseTaskTagAnswers(input)).toEqual(["research"]);
    expect(parseTaskTagAnswers(answers())).toEqual([]);
  });
  it("rejects unknown, incomplete and out-of-range answers", () => {
    expect(() =>
      parseTaskTagAnswers({
        ...answers(),
        unknown: { type: "boolean", probability: 1 },
      }),
    ).toThrow();
    expect(() => parseTaskTagAnswers({})).toThrow();
    const input = answers();
    input.research.probability = 2;
    expect(() => parseTaskTagAnswers(input)).toThrow();
  });
});
