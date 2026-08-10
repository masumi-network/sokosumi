/**
 * Vocabulary for the answers collected by the signup onboarding flow.
 *
 * Shared so Core validates exactly the set web renders: the values are
 * persisted as plain strings on `User.metadata`, and a typo on either side
 * would silently store an option nothing can read back.
 */

export const ONBOARDING_COMPANY_TYPES = [
  "agency",
  "ecommerce",
  "saas",
  "media",
  "finance",
  "healthcare",
  "education",
  "nonprofit",
  "other",
] as const;

export const ONBOARDING_COMPANY_SIZES = [
  "solo",
  "2-10",
  "11-50",
  "51-200",
  "201-1000",
  "1000+",
] as const;

export const ONBOARDING_ROLES = [
  "founder",
  "marketing",
  "sales",
  "product",
  "engineering",
  "operations",
  "agency-lead",
  "other",
] as const;

export const ONBOARDING_WORK_STYLES = ["solo", "team"] as const;

export type OnboardingCompanyType = (typeof ONBOARDING_COMPANY_TYPES)[number];
export type OnboardingCompanySize = (typeof ONBOARDING_COMPANY_SIZES)[number];
export type OnboardingRole = (typeof ONBOARDING_ROLES)[number];
export type OnboardingWorkStyle = (typeof ONBOARDING_WORK_STYLES)[number];

export interface OnboardingProfile {
  companySize: null | OnboardingCompanySize;
  companyType: null | OnboardingCompanyType;
  role: null | OnboardingRole;
  workStyle: null | OnboardingWorkStyle;
}

function parseOption<T extends string>(
  options: readonly T[],
  value: unknown,
): null | T {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return options.includes(trimmedValue as T) ? (trimmedValue as T) : null;
}

export function parseOnboardingCompanyType(
  value: unknown,
): null | OnboardingCompanyType {
  return parseOption(ONBOARDING_COMPANY_TYPES, value);
}

export function parseOnboardingCompanySize(
  value: unknown,
): null | OnboardingCompanySize {
  return parseOption(ONBOARDING_COMPANY_SIZES, value);
}

export function parseOnboardingRole(value: unknown): null | OnboardingRole {
  return parseOption(ONBOARDING_ROLES, value);
}

export function parseOnboardingWorkStyle(
  value: unknown,
): null | OnboardingWorkStyle {
  return parseOption(ONBOARDING_WORK_STYLES, value);
}
