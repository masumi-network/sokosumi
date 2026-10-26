import { describe, expect, it } from "vitest";

import { SOCIAL_BETA_ORGANIZATION_SLUG } from "./social-beta.js";
import {
  isSocialProviderEnabled,
  SOCIAL_BETA_PROVIDERS,
  SOCIAL_POST_TEXT_LIMITS,
  SOCIAL_PUBLIC_PROVIDERS,
  socialPostProviderLabel,
  socialProvidersForWorkspace,
  socialProviderUnavailableMessage,
} from "./social-post.js";

describe("Social provider availability", () => {
  it.each([null, "other", "UTXO", "utxo-other"])(
    "enables the public list in workspace %s",
    (organizationSlug) => {
      const workspace = { organizationSlug };
      expect(socialProvidersForWorkspace(workspace)).toEqual([
        "x",
        "youtube",
        "linkedin",
      ]);
      for (const provider of SOCIAL_BETA_PROVIDERS) {
        expect(isSocialProviderEnabled(provider, workspace)).toBe(
          (SOCIAL_PUBLIC_PROVIDERS as readonly string[]).includes(provider),
        );
      }
    },
  );

  it("enables every provider in the beta workspace", () => {
    const workspace = { organizationSlug: SOCIAL_BETA_ORGANIZATION_SLUG };
    expect(socialProvidersForWorkspace(workspace)).toEqual(
      Object.keys(SOCIAL_POST_TEXT_LIMITS),
    );
    for (const provider of SOCIAL_BETA_PROVIDERS) {
      expect(isSocialProviderEnabled(provider, workspace)).toBe(true);
      expect(socialProviderUnavailableMessage(provider, workspace)).toBeNull();
    }
  });

  it.each(["tiktok", "instagram", "facebook"] as const)(
    "explains %s availability using the public list",
    (provider) => {
      const available = new Intl.ListFormat("en", {
        type: "conjunction",
      }).format(SOCIAL_PUBLIC_PROVIDERS.map(socialPostProviderLabel));
      expect(
        socialProviderUnavailableMessage(provider, { organizationSlug: null }),
      ).toBe(
        `${socialPostProviderLabel(provider)} is coming soon. Available now: ${available}.`,
      );
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
