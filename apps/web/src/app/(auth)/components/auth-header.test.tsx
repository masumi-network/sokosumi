import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import messages from "@/../messages/en.json";

import { AuthHeader } from "./auth-header";

const CMO = {
  name: "CMO",
  uri: "https://cmo.xyz",
  logoUri: "https://cmo.xyz/logo.png",
};

function renderHeader(props: ComponentProps<typeof AuthHeader>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AuthHeader {...props} />
    </NextIntlClientProvider>,
  );
}

describe("AuthHeader", () => {
  it.each([
    ["signIn", "Log in with your Sokosumi account to continue to CMO"],
    ["signUp", "Create your Sokosumi account to continue to CMO"],
  ] as const)(
    "leads %s with the way back to the product, then names it",
    (mode, description) => {
      renderHeader({ mode, client: CMO });

      const back = screen.getByRole("link", { name: "Back to CMO" });
      // Above the title, so the way back is read first.
      expect(
        back.compareDocumentPosition(screen.getByRole("heading")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(screen.getByText(description)).toBeInTheDocument();
    },
  );

  it.each(["signIn", "signUp"] as const)(
    "stays the plain %s header without an OAuth request",
    (mode) => {
      const { container } = renderHeader({ mode });

      expect(
        screen.getByText("Hire agents on our platform"),
      ).toBeInTheDocument();
      expect(container.querySelector("img")).toBeNull();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    },
  );

  it("says Register came from an invitation", () => {
    renderHeader({ mode: "signUp", invitationId: "inv_1" });

    expect(screen.getByText("(via invitation)")).toBeInTheDocument();
  });

  it("keeps Log in's title plain for an invitation", () => {
    renderHeader({ mode: "signIn", invitationId: "inv_1" });

    expect(screen.queryByText("(via invitation)")).not.toBeInTheDocument();
  });
});
