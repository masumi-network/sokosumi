import { describe, expect, it } from "vitest";

import { ALPHA_TONES } from "./tokens";

describe("ALPHA_TONES", () => {
  it("matches the brand guide: step + opacity percent = 100", () => {
    expect(ALPHA_TONES.map((tone) => [tone.step, tone.value])).toEqual([
      [10, "rgb(0 0 0 / 0.9)"],
      [20, "rgb(0 0 0 / 0.8)"],
      [30, "rgb(0 0 0 / 0.7)"],
      [40, "rgb(0 0 0 / 0.6)"],
      [50, "rgb(0 0 0 / 0.5)"],
      [60, "rgb(0 0 0 / 0.4)"],
      [70, "rgb(0 0 0 / 0.3)"],
      [80, "rgb(0 0 0 / 0.2)"],
      [90, "rgb(0 0 0 / 0.1)"],
      [95, "rgb(0 0 0 / 0.05)"],
    ]);
  });
});
