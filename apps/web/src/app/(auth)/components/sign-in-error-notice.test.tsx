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
    ["state_mismatch", "expired"],
    ["state_not_found", "expired"],
    ["state_invalid", "expired"],
    ["please_restart_the_process", "expired"],
    ["invalid_client", "clientMisconfigured"],
    ["client_disabled", "clientMisconfigured"],
    ["unauthorized_client", "clientMisconfigured"],
    ["invalid_redirect", "clientMisconfigured"],
    ["unsupported_response_type", "clientMisconfigured"],
    ["unsupported_prompt_select_account", "clientMisconfigured"],
  ])("explains %s", (error, message) => {
    render(<SignInErrorNotice error={error} />);

    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });

  it.each(["internal_server_error", "constructor"])(
    "falls back to the generic message for %s",
    (error) => {
      render(<SignInErrorNotice error={error} />);

      expect(screen.getByRole("alert")).toHaveTextContent("generic");
    },
  );
});
