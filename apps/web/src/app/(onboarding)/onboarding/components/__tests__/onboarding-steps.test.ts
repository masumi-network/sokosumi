import { describe, expect, it } from "vitest";

import {
  EMPTY_ONBOARDING_ANSWERS,
  isOnboardingAnswerComplete,
  type OnboardingAnswers,
  type ResolveOnboardingStepsInput,
  resolveOnboardingSteps,
} from "../onboarding-steps";

const ANSWERED: OnboardingAnswers = {
  companySize: "11-50",
  companyType: "agency",
  role: "founder",
  workStyle: "team",
};

function steps(overrides: Partial<ResolveOnboardingStepsInput> = {}) {
  return resolveOnboardingSteps({
    answers: ANSWERED,
    hasJoinedOrganization: false,
    teamPath: null,
    variant: "full",
    ...overrides,
  });
}

describe("resolveOnboardingSteps", () => {
  it("asks only who the user is when they arrived through an invite", () => {
    expect(steps({ variant: "joined" })).toEqual([
      "welcome",
      "companyType",
      "companySize",
      "role",
    ]);
  });

  it("keeps the joined variant short even once answers exist", () => {
    expect(steps({ teamPath: "create", variant: "joined" })).not.toContain(
      "plan",
    );
  });

  it("stops at the work-style question until it is answered", () => {
    expect(steps({ answers: { ...ANSWERED, workStyle: null } })).toEqual([
      "welcome",
      "companyType",
      "companySize",
      "role",
      "workStyle",
    ]);
  });

  it("sends a solo user straight to the plan picker", () => {
    const result = steps({ answers: { ...ANSWERED, workStyle: "solo" } });

    expect(result).toEqual([
      "welcome",
      "companyType",
      "companySize",
      "role",
      "workStyle",
      "plan",
    ]);
    expect(result).not.toContain("teamChoice");
    expect(result).not.toContain("createOrganization");
  });

  it("adds the team fork once the user says they work with a team", () => {
    expect(steps()).toEqual([
      "welcome",
      "companyType",
      "companySize",
      "role",
      "workStyle",
      "teamChoice",
    ]);
  });

  it("skips the plan picker when redeeming an invite link", () => {
    const result = steps({ teamPath: "invite" });

    expect(result.at(-1)).toBe("inviteLink");
    expect(result).not.toContain("plan");
  });

  it("offers plans after the user creates their own organization", () => {
    expect(steps({ teamPath: "create" })).toEqual([
      "welcome",
      "companyType",
      "companySize",
      "role",
      "workStyle",
      "teamChoice",
      "createOrganization",
      "plan",
    ]);
  });

  it("drops the plan picker once an organization has been joined", () => {
    // Guards the preview toolbar's joined scenarios, which can pair
    // teamPath=create with an already-joined organization.
    expect(
      steps({ hasJoinedOrganization: true, teamPath: "create" }),
    ).not.toContain("plan");
  });

  it("never returns an empty sequence", () => {
    expect(steps({ answers: EMPTY_ONBOARDING_ANSWERS }).length).toBeGreaterThan(
      0,
    );
  });
});

describe("isOnboardingAnswerComplete", () => {
  it("requires every question in the full variant", () => {
    expect(isOnboardingAnswerComplete(ANSWERED, "full")).toBe(true);
    expect(
      isOnboardingAnswerComplete({ ...ANSWERED, workStyle: null }, "full"),
    ).toBe(false);
    expect(
      isOnboardingAnswerComplete({ ...ANSWERED, role: null }, "full"),
    ).toBe(false);
  });

  it("does not require a work style in the joined variant", () => {
    expect(
      isOnboardingAnswerComplete({ ...ANSWERED, workStyle: null }, "joined"),
    ).toBe(true);
  });

  it("rejects an empty answer set", () => {
    expect(isOnboardingAnswerComplete(EMPTY_ONBOARDING_ANSWERS, "full")).toBe(
      false,
    );
    expect(isOnboardingAnswerComplete(EMPTY_ONBOARDING_ANSWERS, "joined")).toBe(
      false,
    );
  });
});
