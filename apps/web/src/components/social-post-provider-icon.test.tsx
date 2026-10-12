import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SocialPostProviderIcon } from "./social-post-provider-icon";

const PROVIDERS = [
  "x",
  "linkedin",
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
] as const;

describe("SocialPostProviderIcon", () => {
  it.each(PROVIDERS)("draws the %s brand mark", (provider) => {
    const { container } = render(
      <SocialPostProviderIcon aria-hidden provider={provider} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
