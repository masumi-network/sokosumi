export const ONBOARDING_STEP_IDS = [
  "welcome",
  "workStyle",
  "teamChoice",
  "inviteLink",
  "createOrganization",
  "plan",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

/** Whether the user works alone or with a team — the only thing we ask. */
export type OnboardingWorkStyle = "solo" | "team";

/** Which route the user picked after saying they work with a team. */
export type OnboardingTeamPath = "create" | "invite";

export interface ResolveOnboardingStepsInput {
  /** True once an invite link has actually been redeemed. */
  hasJoinedOrganization: boolean;
  teamPath: null | OnboardingTeamPath;
  workStyle: null | OnboardingWorkStyle;
}

/**
 * The screens this particular user will see, in order.
 *
 * The sequence grows as the answer comes in rather than being fixed up front:
 * picking "with a team" genuinely adds work, and padding the rail with steps a
 * solo user will never reach would misreport how much is left.
 */
export function resolveOnboardingSteps({
  hasJoinedOrganization,
  teamPath,
  workStyle,
}: ResolveOnboardingStepsInput): OnboardingStepId[] {
  const steps: OnboardingStepId[] = ["welcome", "workStyle"];

  if (workStyle === "solo") {
    steps.push("plan");
    return steps;
  }

  if (workStyle !== "team") {
    return steps;
  }

  steps.push("teamChoice");

  if (teamPath === "invite") {
    steps.push("inviteLink");
    // Joining an existing team means inheriting its subscription, so the plan
    // picker would be offering something the user cannot act on.
    return steps;
  }

  if (teamPath === "create") {
    steps.push("createOrganization");
    if (!hasJoinedOrganization) {
      steps.push("plan");
    }
  }

  return steps;
}
