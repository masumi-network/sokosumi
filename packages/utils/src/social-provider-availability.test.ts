import { describe, expect, it } from "vitest";

import { SOCIAL_BETA_ORGANIZATION_SLUG } from "./social-beta.js";
import {
  isSocialProviderEnabled,
  SOCIAL_POST_TEXT_LIMITS,
  SOCIAL_PUBLIC_PROVIDERS,
  type SocialPostProvider,
  socialPostProviderLabel,
  socialProvidersForWorkspace,
  socialProviderUnavailableMessage,
} from "./social-post.js";

const ALL_PROVIDERS = Object.keys(
  SOCIAL_POST_TEXT_LIMITS,
) as SocialPostProvider[];

describe("Social provider availability", () => {
  it.each([null, "other", SOCIAL_BETA_ORGANIZATION_SLUG, "UTXO", "utxo-other"])(
    "enables the public list in workspace %s",
    (organizationSlug) => {
      const workspace = { organizationSlug };
      expect(socialProvidersForWorkspace(workspace)).toEqual([
        "x",
        "youtube",
        "linkedin",
      ]);
      for (const provider of ALL_PROVIDERS) {
        expect(isSocialProviderEnabled(provider, workspace)).toBe(
          (SOCIAL_PUBLIC_PROVIDERS as readonly string[]).includes(provider),
        );
      }
    },
  );

  it.each(["tiktok", "instagram", "facebook"] as const)(
    "explains %s availability using the public list in every workspace",
    (provider) => {
      const available = new Intl.ListFormat("en", {
        type: "conjunction",
      }).format(SOCIAL_PUBLIC_PROVIDERS.map(socialPostProviderLabel));
      for (const organizationSlug of [null, SOCIAL_BETA_ORGANIZATION_SLUG]) {
        expect(
          socialProviderUnavailableMessage(provider, { organizationSlug }),
        ).toBe(
          `${socialPostProviderLabel(provider)} is coming soon. Available now: ${available}.`,
        );
      }
    },
  );

  it.each(SOCIAL_PUBLIC_PROVIDERS)(
    "has no unavailable reason for %s",
    (provider) => {
      expect(
        socialProviderUnavailableMessage(provider, { organizationSlug: null }),
      ).toBeNull();
    },
  );

  it.each(["threads", "", "X", "toString", "__proto__"])(
    "does not enable an unknown provider: %s",
    (provider) => {
      for (const organizationSlug of [null, "other", "utxo"]) {
        expect(isSocialProviderEnabled(provider, { organizationSlug })).toBe(
          false,
        );
      }
    },
  );
});
