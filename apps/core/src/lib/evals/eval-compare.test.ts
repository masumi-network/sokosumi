import { describe, expect, it } from "vitest";
import {
  aboveUsual,
  countOutcomes,
  evalOutcome,
  median,
  passRate,
  usualValue,
} from "./eval-compare";

describe("passRate", () => {
  it("leaves out skipped and unscored repeats", () => {
    expect(passRate(["PASSED", "FAILED", "SKIPPED", "PENDING"])).toBe(0.5);
    expect(passRate(["SKIPPED"])).toBeNull();
  });

  it("counts an error as not passing", () => {
    expect(passRate(["PASSED", "ERROR"])).toBe(0.5);
  });
});

describe("evalOutcome", () => {
  it("is passing when every repeat passes", () => {
    expect(evalOutcome(["PASSED", "PASSED", "PASSED"], [1, 1])).toBe("passing");
  });

  it("is fixed when the last daily run failed every repeat", () => {
    expect(evalOutcome(["PASSED", "PASSED"], [0, 0])).toBe("fixed");
  });

  it("is passing, not fixed, after a flaky last run", () => {
    expect(evalOutcome(["PASSED", "PASSED"], [0.67, 1])).toBe("passing");
  });

  it("is flaky, not regressed, when a case that always passed fails a minority of repeats", () => {
    expect(evalOutcome(["PASSED", "FAILED", "PASSED"], [1, 1, 1])).toBe(
      "flaky",
    );
    expect(evalOutcome(["PASSED", "FAILED"], [1, 1, 1])).toBe("flaky");
  });

  it("is regressed when most repeats of a case that always passed fail", () => {
    expect(evalOutcome(["FAILED", "FAILED", "PASSED"], [1, 1, 1])).toBe(
      "regressed",
    );
  });

  it("is flaky when it fails one repeat and has failed before", () => {
    expect(evalOutcome(["PASSED", "FAILED", "PASSED"], [1, 0.67, 1])).toBe(
      "flaky",
    );
  });

  it("is regressed when every repeat fails after a passing baseline", () => {
    expect(evalOutcome(["FAILED", "FAILED"], [1, 0.5])).toBe("regressed");
  });

  it("is failing when it failed before and fails now", () => {
    expect(evalOutcome(["FAILED", "FAILED"], [0, 1])).toBe("failing");
  });

  it("reads a case without history on its own", () => {
    expect(evalOutcome(["PASSED"], [])).toBe("passing");
    expect(evalOutcome(["FAILED"], [])).toBe("failing");
    expect(evalOutcome(["FAILED", "PASSED"], [])).toBe("flaky");
  });

  it("separates errors and skips from failures", () => {
    expect(evalOutcome(["ERROR", "ERROR"], [1])).toBe("error");
    expect(evalOutcome(["SKIPPED", "SKIPPED"], [1])).toBe("skipped");
    expect(evalOutcome(["ERROR", "SKIPPED"], [1])).toBe("error");
  });

  it.each([{ history: [] }, { history: [1, 1] }, { history: [0, 0.5] }])(
    "does not call a successful repeat plus an execution error a behavior regression: $history",
    ({ history }) => {
      expect(evalOutcome(["PASSED", "ERROR"], history)).toBe("error");
      expect(evalOutcome(["ERROR", "PENDING"], history)).toBe("error");
    },
  );

  it("keeps genuine behavior failures visible when another repeat has an error", () => {
    expect(evalOutcome(["FAILED", "ERROR"], [1])).toBe("regressed");
    expect(evalOutcome(["PASSED", "FAILED", "ERROR"], [])).toBe("flaky");
  });

  it("waits while no repeat has finished", () => {
    expect(evalOutcome(["PENDING", "RUNNING"], [1])).toBe("pending");
    expect(evalOutcome(["PASSED", "PENDING"], [1])).toBe("passing");
  });
});

describe("usual cost and duration", () => {
  it("takes the median of the last five weekly runs", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(usualValue([1, 2, 3, 4, 5, 100])).toBe(3);
  });

  it("says nothing with fewer than three weekly runs", () => {
    expect(usualValue([1, 2])).toBeNull();
    expect(aboveUsual(10, usualValue([1, 2]))).toBe(false);
  });

  it("flags only values above 1.3 times the usual one", () => {
    expect(aboveUsual(1.31, 1)).toBe(true);
    expect(aboveUsual(1.3, 1)).toBe(false);
    expect(aboveUsual(null, 1)).toBe(false);
    expect(aboveUsual(5, 0)).toBe(false);
  });
});

describe("countOutcomes", () => {
  it("counts every outcome, zero included", () => {
    expect(countOutcomes(["passing", "passing", "regressed"])).toEqual({
      regressed: 1,
      error: 0,
      failing: 0,
      flaky: 0,
      fixed: 0,
      passing: 2,
      pending: 0,
      skipped: 0,
    });
  });
});
