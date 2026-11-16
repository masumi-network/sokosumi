import { describe, expect, it } from "vitest";

import { cmoBilling } from "../test-fixtures/cmo";
import { cusoSubscribed } from "./cuso-subscribed";

describe("cusoSubscribed", () => {
  it("is true while the Cuso's CMO subscription has not ended, even past due", () => {
    expect(cusoSubscribed({ billing: cmoBilling({ status: "active" }) })).toBe(
      true,
    );
    expect(
      cusoSubscribed({ billing: cmoBilling({ status: "past_due" }) }),
    ).toBe(true);
  });

  it("is false without one", () => {
    expect(cusoSubscribed({ billing: cmoBilling() })).toBe(false);
  });
});
