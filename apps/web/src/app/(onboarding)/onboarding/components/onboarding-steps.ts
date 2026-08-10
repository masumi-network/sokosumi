import type {
  OnboardingCompanySize,
  OnboardingCompanyType,
  OnboardingRole,
  OnboardingWorkStyle,
} from "@sokosumi/utils";

export const ONBOARDING_STEP_IDS = [
  "welcome",
  "companyType",
  "companySize",
  "role",
  "workStyle",
  "teamChoice",
  "inviteLink",
  "createOrganization",
  "plan",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

/**
 * `joined` runs for someone who arrived through an invite link and is already
 * a member: they have a team and inherit its billing, so the flow only still
 * needs to learn who they are.
 */
export type OnboardingVariant = "full" | "joined";

/** Which route the user picked after saying they work with a team. */
export type OnboardingTeamPath = "create" | "invite";

export interface OnboardingAnswers {
  companySize: null | OnboardingCompanySize;
  companyType: null | OnboardingCompanyType;
  role: null | OnboardingRole;
  workStyle: null | OnboardingWorkStyle;
}

export const EMPTY_ONBOARDING_ANSWERS: OnboardingAnswers = {
  companySize: null,
  companyType: null,
  role: null,
  workStyle: null,
};

export interface ResolveOnboardingStepsInput {
  answers: OnboardingAnswers;
  /** True once an invite link has actually been redeemed. */
  hasJoinedOrganization: boolean;
  teamPath: null | OnboardingTeamPath;
  variant: OnboardingVariant;
}

/**
 * The screens this particular user will see, in order.
 *
 * The sequence grows as answers come in rather than being fixed up front:
 * picking "with a team" genuinely adds work, and padding the rail with steps
 * a solo user will never reach would misreport how much is left.
 */
export function resolveOnboardingSteps({
  answers,
  hasJoinedOrganization,
  teamPath,
  variant,
}: ResolveOnboardingStepsInput): OnboardingStepId[] {
  if (variant === "joined") {
    return ["welcome", "companyType", "companySize", "role"];
  }

  // One question per screen: the wizard's rhythm depends on a single focal
  // object per step, which a combined "type + size" screen cannot hold.
  const steps: OnboardingStepId[] = [
    "welcome",
    "companyType",
    "companySize",
    "role",
    "workStyle",
  ];

  if (answers.workStyle === "solo") {
    steps.push("plan");
    return steps;
  }

  if (answers.workStyle !== "team") {
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

/** True when every question the flow asks has an answer. */
export function isOnboardingAnswerComplete(
  answers: OnboardingAnswers,
  variant: OnboardingVariant,
): boolean {
  if (!answers.companyType || !answers.companySize || !answers.role) {
    return false;
  }

  return variant === "joined" || answers.workStyle !== null;
}
