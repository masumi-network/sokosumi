import { describe, expect, it } from "vitest";

import {
  type ResolveOnboardingStepsInput,
  resolveOnboardingSteps,
} from "../onboarding-steps";

function resolve(overrides: Partial<ResolveOnboardingStepsInput> = {}) {
  return resolveOnboardingSteps({
    hasJoinedOrganization: false,
    teamPath: null,
    workStyle: null,
    ...overrides,
  });
}

describe("resolveOnboardingSteps", () => {
  it("asks only the one question before an answer exists", () => {
    expect(resolve()).toEqual(["welcome", "workStyle"]);
  });

  it("sends a solo user straight to plans", () => {
    expect(resolve({ workStyle: "solo" })).toEqual([
      "welcome",
      "workStyle",
      "plan",
    ]);
  });

  it("waits for the team route before growing further", () => {
    // "team" alone is not enough — the next screen is the fork itself, and
    // padding the rail past it would overstate how much is left.
    expect(resolve({ workStyle: "team" })).toEqual([
      "welcome",
      "workStyle",
      "teamChoice",
    ]);
  });

  it("ends at the invite screen, because joining inherits billing", () => {
    expect(resolve({ teamPath: "invite", workStyle: "team" })).toEqual([
      "welcome",
      "workStyle",
      "teamChoice",
      "inviteLink",
    ]);
  });

  it("offers plans after creating a team", () => {
    expect(resolve({ teamPath: "create", workStyle: "team" })).toEqual([
      "welcome",
      "workStyle",
      "teamChoice",
      "createOrganization",
      "plan",
    ]);
  });

  it("drops the plan step once an invite has actually been redeemed", () => {
    expect(
      resolve({
        hasJoinedOrganization: true,
        teamPath: "create",
        workStyle: "team",
      }),
    ).toEqual(["welcome", "workStyle", "teamChoice", "createOrganization"]);
  });

  it("shortens when the user switches back from team to solo", () => {
    // The regression behind the stale-index bug: the sequence can get shorter
    // under a cursor that was already past the new end.
    const team = resolve({ teamPath: "create", workStyle: "team" });
    const solo = resolve({ teamPath: "create", workStyle: "solo" });

    expect(solo.length).toBeLessThan(team.length);
    expect(solo).toEqual(["welcome", "workStyle", "plan"]);
  });
});
