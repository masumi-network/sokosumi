import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SignInErrorNotice from "./sign-in-error-notice";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("SignInErrorNotice", () => {
  it("shows nothing without an error", () => {
    const { container } = render(<SignInErrorNotice error={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["account_not_linked", "accountNotLinked"],
    ["access_denied", "cancelled"],
    ["INVALID_TOKEN", "linkExpired"],
  ])("explains %s", (error, message) => {
    render(<SignInErrorNotice error={error} />);

    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });

  it.each(["state_mismatch", "constructor"])(
    "falls back to the generic message for %s",
    (error) => {
      render(<SignInErrorNotice error={error} />);

      expect(screen.getByRole("alert")).toHaveTextContent("generic");
    },
  );
});
