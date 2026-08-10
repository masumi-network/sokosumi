import {
  buildMetadataWithDesignMd,
  buildMetadataWithStringFields,
  buildMetadataWithUrl,
  getNormalizedStringField,
  type MetadataRecord,
  parseMetadataRecord,
} from "./metadata-record.js";
import {
  type OnboardingProfile,
  parseOnboardingCompanySize,
  parseOnboardingCompanyType,
  parseOnboardingRole,
  parseOnboardingWorkStyle,
} from "./onboarding-profile.js";

interface UserMetadataRecord extends MetadataRecord {}

const ONBOARDING_COMPANY_SIZE_KEY = "onboardingCompanySize";
const ONBOARDING_COMPANY_TYPE_KEY = "onboardingCompanyType";
const ONBOARDING_ROLE_KEY = "onboardingRole";
const ONBOARDING_WORK_STYLE_KEY = "onboardingWorkStyle";

export interface UserMetadata {
  designMdExtractionId: null | string;
  designMdUrl: null | string;
  url: null | string;
}

export function parseUserMetadata(
  metadata: unknown,
): UserMetadataRecord | null {
  return parseMetadataRecord(metadata);
}

export function getUserMetadata(metadata: unknown): UserMetadata {
  const parsedMetadata = parseUserMetadata(metadata);

  return {
    designMdExtractionId: getNormalizedStringField(
      parsedMetadata,
      "designMdExtractionId",
    ),
    designMdUrl: getNormalizedStringField(parsedMetadata, "designMdUrl"),
    url: getNormalizedStringField(parsedMetadata, "url"),
  };
}

export function buildUserMetadataWithUrl(
  metadata: UserMetadataRecord | null | undefined,
  rawUrl: string | null | undefined,
): UserMetadataRecord | null {
  return buildMetadataWithUrl(metadata, rawUrl);
}

export function buildUserMetadataWithDesignMd(
  metadata: UserMetadataRecord | null | undefined,
  designMd: {
    extractionId?: null | string;
    url?: null | string;
  },
): UserMetadataRecord | null {
  return buildMetadataWithDesignMd(metadata, designMd);
}

/** Reads the answers collected by the signup onboarding flow. */
export function getUserOnboardingProfile(metadata: unknown): OnboardingProfile {
  const parsedMetadata = parseUserMetadata(metadata);

  return {
    companySize: parseOnboardingCompanySize(
      getNormalizedStringField(parsedMetadata, ONBOARDING_COMPANY_SIZE_KEY),
    ),
    companyType: parseOnboardingCompanyType(
      getNormalizedStringField(parsedMetadata, ONBOARDING_COMPANY_TYPE_KEY),
    ),
    role: parseOnboardingRole(
      getNormalizedStringField(parsedMetadata, ONBOARDING_ROLE_KEY),
    ),
    workStyle: parseOnboardingWorkStyle(
      getNormalizedStringField(parsedMetadata, ONBOARDING_WORK_STYLE_KEY),
    ),
  };
}

/**
 * Merges onboarding answers into a user's metadata. Omitted keys keep their
 * stored value, so a later step can add its answer without resending earlier
 * ones; an explicit `null` clears the field. Values outside the shared
 * vocabulary are dropped rather than stored.
 */
export function buildUserMetadataWithOnboardingProfile(
  metadata: UserMetadataRecord | null | undefined,
  profile: Partial<OnboardingProfile>,
): UserMetadataRecord | null {
  return buildMetadataWithStringFields(metadata, {
    ...("companySize" in profile
      ? {
          [ONBOARDING_COMPANY_SIZE_KEY]: parseOnboardingCompanySize(
            profile.companySize,
          ),
        }
      : {}),
    ...("companyType" in profile
      ? {
          [ONBOARDING_COMPANY_TYPE_KEY]: parseOnboardingCompanyType(
            profile.companyType,
          ),
        }
      : {}),
    ...("role" in profile
      ? { [ONBOARDING_ROLE_KEY]: parseOnboardingRole(profile.role) }
      : {}),
    ...("workStyle" in profile
      ? {
          [ONBOARDING_WORK_STYLE_KEY]: parseOnboardingWorkStyle(
            profile.workStyle,
          ),
        }
      : {}),
  });
}
