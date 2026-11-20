import { describe, expect, it } from "vitest";
import { evalInfrastructureFailure } from "./eval-infrastructure";

const budget = {
  status: "FAILED",
  errorKind: "GatewayInternalServerError",
  errorDetail:
    "API key budget exceeded. Current spend: $400.12, limit: $400.00.",
};

describe("typed evaluation infrastructure failures", () => {
  it("stops later eval cases for the classified budget failure", () => {
    expect(
      evalInfrastructureFailure({
        status: "FAILED",
        errorKind: "ai_budget_exceeded",
        errorDetail: "Your assistant has reached its usage limit.",
      }),
    ).toMatchObject({ code: "provider_budget_exhausted", stopsRun: true });
  });

  it("recognizes a hard provider budget cap and bounds its stored detail", () => {
    expect(evalInfrastructureFailure(budget)).toMatchObject({
      code: "provider_budget_exhausted",
      stopsRun: true,
    });
    expect(
      evalInfrastructureFailure({
        ...budget,
        errorDetail: budget.errorDetail + "x".repeat(10_000),
      })?.detail,
    ).toHaveLength(2_000);
  });

  it("keeps an unexplained runner exit separate from provider budget exhaustion", () => {
    expect(
      evalInfrastructureFailure({
        ...budget,
        errorKind: "runner_exited",
        errorDetail: "The runner ended with exit code 1",
      }),
    ).toMatchObject({
      code: "runner_exited",
      stopsRun: false,
      detail: "The runner ended with exit code 1",
    });
  });

  it("records transient provider errors without stopping later cases", () => {
    expect(
      evalInfrastructureFailure({
        ...budget,
        errorDetail: "Temporary upstream failure",
      }),
    ).toMatchObject({ code: "provider_failure", stopsRun: false });
  });

  it.each([
    { ...budget, status: "COMPLETED" },
    { ...budget, status: "RUNNING" },
    { ...budget, errorKind: "validation" },
    { ...budget, errorKind: "Error" },
    { status: "FAILED", errorKind: null, errorDetail: null },
  ])("does not disguise normal behavior or unknown failures: %j", (turn) => {
    expect(evalInfrastructureFailure(turn)).toBeNull();
  });
});
