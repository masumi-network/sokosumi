import {
  SOCIAL_BETA_ORGANIZATION_SLUG,
  socialProvidersForWorkspace,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  SOCIAL_PROVIDERS,
  socialProvidersEnabledFirst,
} from "./social-providers";

describe("socialProvidersEnabledFirst", () => {
  it.each([null, SOCIAL_BETA_ORGANIZATION_SLUG])(
    "lists connectable platforms first in workspace %s, each group in its original order",
    (organizationSlug) => {
      expect(
        socialProvidersEnabledFirst(
          socialProvidersForWorkspace({ organizationSlug }),
        ).map(({ id }) => id),
      ).toEqual([
        "x",
        "linkedin",
        "youtube",
        "tiktok",
        "instagram",
        "facebook",
      ]);
    },
  );

  it("keeps the original order when every platform is connectable", () => {
    expect(
      socialProvidersEnabledFirst(SOCIAL_PROVIDERS.map(({ id }) => id)),
    ).toEqual(SOCIAL_PROVIDERS);
  });
});

describe("SOCIAL_PROVIDERS", () => {
  it("lists every project network independently of workspace availability", () => {
    expect(SOCIAL_PROVIDERS.map((provider) => provider.id)).toEqual([
      "x",
      "tiktok",
      "instagram",
      "linkedin",
      "facebook",
      "youtube",
    ]);
    expect(
      SOCIAL_PROVIDERS.every((provider) => typeof provider.Icon === "function"),
    ).toBe(true);
  });
});
