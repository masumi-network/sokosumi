import { describe, expect, it } from "vitest";
import {
  aboveUsual,
  caseWeightedPassRate,
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

  it("leaves out errors: a case that could not run has no verdict", () => {
    expect(passRate(["PASSED", "ERROR"])).toBe(1);
    expect(passRate(["ERROR", "ERROR"])).toBeNull();
  });
});

describe("caseWeightedPassRate", () => {
  it("counts every case once, whatever its repeats", () => {
    // A judged case passing 2 of 2 and an unjudged case failing 1 of 1.
    const rates = [passRate(["PASSED", "PASSED"]), passRate(["FAILED"])];
    expect(caseWeightedPassRate(rates)).toBe(0.5);
    expect(caseWeightedPassRate([passRate(["PASSED"]), 0])).toBe(0.5);
  });

  it("leaves out cases without a verdict", () => {
    expect(caseWeightedPassRate([1, null])).toBe(1);
    expect(caseWeightedPassRate([null])).toBeNull();
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

  it("is not fixed when the baseline could only error: errors are no verdict", () => {
    const baseline = passRate(["ERROR"]);
    expect(baseline).toBeNull();
    const history = [baseline].filter((rate): rate is number => rate !== null);
    expect(evalOutcome(["PASSED"], history)).toBe("passing");
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

  it("never reaches past the last five weekly runs to fill gaps", () => {
    // No value in the five recent weeks; weeks six to eight have one.
    expect(usualValue([null, null, null, null, null, 1, 1, 1])).toBeNull();
    expect(usualValue([null, 1, null, 2, null, 3, 3])).toBeNull();
    expect(usualValue([1, null, 2, null, 3, 100])).toBe(2);
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
