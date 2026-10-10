import { describe, expect, it } from "vitest";

import {
  isProjectSocialProvider,
  PROJECT_SOCIAL_PROVIDERS,
} from "./social-providers";

describe("isProjectSocialProvider", () => {
  it("accepts every configured Social provider", () => {
    for (const provider of Object.keys(PROJECT_SOCIAL_PROVIDERS)) {
      expect(isProjectSocialProvider(provider)).toBe(true);
    }
  });

  it.each(["twitter", "Twitter", "x ", "", "threads"])(
    "rejects %s",
    (provider) => {
      expect(isProjectSocialProvider(provider)).toBe(false);
    },
  );
});
