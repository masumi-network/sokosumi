import { describe, expect, it } from "vitest";
import {
  estimateInputTokens,
  StepAdmission,
  turnTokenBudget,
} from "./turn-budget";

describe("StepAdmission", () => {
  it("lets calls running at once see each other's reservations", () => {
    const budget = turnTokenBudget(25, 10);
    const one = new StepAdmission(budget);
    const two = new StepAdmission(budget);
    const three = new StepAdmission(budget);
    expect(one.admit()).toBe(true);
    expect(two.admit()).toBe(true);
    // 20 reserved, 10 more would pass 25.
    expect(three.admit()).toBe(false);
    one.settle(10);
    two.settle(10);
    expect(budget).toMatchObject({ used: 20, reserved: 0 });
  });

  it("reserves the size of the largest step so far", () => {
    const budget = turnTokenBudget(100, 1);
    const call = new StepAdmission(budget);
    call.admit();
    call.settle(60);
    expect(budget.perStep).toBe(60);
    // 60 used, a 60-token step would pass 100.
    expect(call.admit()).toBe(false);
  });

  it("books a wrap-up it never admitted, and gives back an unused reservation", () => {
    const budget = turnTokenBudget(10, 10);
    const call = new StepAdmission(budget);
    expect(call.admit()).toBe(true);
    call.release();
    expect(budget.reserved).toBe(0);
    call.settle(12);
    expect(budget).toMatchObject({ used: 12, reserved: 0 });
  });

  it("admits everything without a budget, as for an older Core", () => {
    expect(new StepAdmission(undefined).admit()).toBe(true);
  });

  it("estimates a prompt at about four characters a token", () => {
    expect(estimateInputTokens("a".repeat(400), "b".repeat(4))).toBe(101);
  });
});
