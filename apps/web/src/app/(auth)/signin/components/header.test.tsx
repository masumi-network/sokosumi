import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import messages from "@/../messages/en.json";

import SignInHeader from "./header";

const CMO = {
  name: "CMO",
  uri: "https://cmo.xyz",
  logoUri: "https://cmo.xyz/logo.png",
};

function renderHeader(props: ComponentProps<typeof SignInHeader>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SignInHeader {...props} />
    </NextIntlClientProvider>,
  );
}

describe("SignInHeader", () => {
  it("leads with the way back to the product, then names it", () => {
    renderHeader({ client: CMO });

    const back = screen.getByRole("link", { name: "Back to CMO" });
    // Above the title, so the way back is read first.
    expect(
      back.compareDocumentPosition(screen.getByRole("heading")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByText("Sign in with your Sokosumi account to continue to CMO"),
    ).toBeInTheDocument();
  });

  it("stays the plain header without an OAuth request", () => {
    const { container } = renderHeader({});

    expect(screen.getByText("Hire agents on our platform")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
