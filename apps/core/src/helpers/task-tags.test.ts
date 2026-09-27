import { describe, expect, it } from "vitest";
import {
  correctTaskTags,
  mapTaskTags,
  parseTaskTagAnswers,
  TASK_TAG_IDS,
} from "./task-tags";

describe("task tag corrections", () => {
  it("keeps manual choices and rejects removed suggestions across new classifications", () => {
    const corrections = correctTaskTags(
      { manualTags: ["writing"] },
      ["research"],
      ["social"],
    );
    expect(
      mapTaskTags({
        ...corrections,
        automaticTags: ["social", "research", "marketing"],
      }),
    ).toEqual({
      manual: ["writing", "research"],
      rejected: ["social"],
      automatic: ["marketing"],
    });
    expect(
      correctTaskTags(corrections, ["social"], ["writing"]).rejectedTags,
    ).toEqual(["writing"]);
  });
  it("bounds visible tags and filters unknown persisted IDs", () => {
    expect(
      mapTaskTags({
        manualTags: ["research", "writing", "strategy", "design", "analysis"],
        automaticTags: ["social", "bogus"],
      }).automatic,
    ).toEqual([]);
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
