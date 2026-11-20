import { describe, expect, it } from "vitest";
import { namesAnyEntry } from "./cmo";

// cmo-v8: a weekly save hears only the repeats among the entries it sent.
describe("namesAnyEntry", () => {
  const problem =
    'w2-x-10, w3-ig-01 argue one claim ("A launch should say when a buyer pays"); 3 pieces a month at most, never two in one week. Keep w2-x-10 and give the others their own claim from their pillar.';

  it("finds a repeat among the entries a save sent", () => {
    expect(namesAnyEntry(problem, new Set(["w3-ig-01"]))).toBe(true);
    expect(
      namesAnyEntry(
        'w1-li-1, w1-li-2 say one thing ("A", "B"); keep w1-li-1.',
        new Set(["w1-li-2"]),
      ),
    ).toBe(true);
  });

  it("leaves out a repeat among earlier weeks only", () => {
    expect(namesAnyEntry(problem, new Set(["w4-x-01", "w2-x-1"]))).toBe(false);
  });
});
