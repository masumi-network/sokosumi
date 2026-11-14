import { describe, expect, it } from "vitest";
import { countOutcomes, evalOutcome, passRate } from "./eval-compare";

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

  it("is regressed when a case that always passed fails one repeat", () => {
    expect(evalOutcome(["PASSED", "FAILED", "PASSED"], [1, 1, 1])).toBe(
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

  it("waits while no repeat has finished", () => {
    expect(evalOutcome(["PENDING", "RUNNING"], [1])).toBe("pending");
    expect(evalOutcome(["PASSED", "PENDING"], [1])).toBe("passing");
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
