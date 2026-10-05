import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import messages from "@/../messages/en.json";
import type { OAuthRequestClient } from "@/lib/auth/oauth-request.server";

import OAuthClientBackLink from "./oauth-client-back-link";

const CMO: OAuthRequestClient = {
  name: "CMO",
  uri: "https://cmo.xyz",
  logoUri: "https://cmo.xyz/logo.png",
};

function renderBackLink(client: OAuthRequestClient) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <OAuthClientBackLink client={client} />
    </NextIntlClientProvider>,
  );
}

describe("OAuthClientBackLink", () => {
  it("leads back to the product, its logo inside", () => {
    renderBackLink(CMO);

    const back = screen.getByRole("link", { name: "Back to CMO" });
    expect(back).toHaveAttribute("href", "https://cmo.xyz");
    expect(back.querySelector("img")).toHaveAttribute(
      "src",
      "https://cmo.xyz/logo.png",
    );
  });

  it("shows the logo without a link when the row has no home page", () => {
    const { container } = renderBackLink({ ...CMO, uri: undefined });

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://cmo.xyz/logo.png",
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows nothing when the row carries neither", () => {
    const { container } = renderBackLink({
      name: "CMO",
      uri: undefined,
      logoUri: undefined,
    });

    expect(container).toBeEmptyDOMElement();
  });
});
