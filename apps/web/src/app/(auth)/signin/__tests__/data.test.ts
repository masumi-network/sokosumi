import { describe, expect, it } from "vitest";

import { signInFormData } from "../data";

describe("signInFormData", () => {
  it("sets current-password autocomplete on the password field", () => {
    const passwordField = signInFormData.find(
      (item) => item.name === "currentPassword",
    );

    expect(passwordField?.autoComplete).toBe("current-password");
  });
});
