import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const openConsentPreferencesMock = vi.fn();

vi.mock("@/components/analytics/cookie-banner", () => ({
  openConsentPreferences: (...args: unknown[]) =>
    openConsentPreferencesMock(...args),
}));

import {
  YouDeveloperStackClient,
  YouHelpStackClient,
  YouLegalStackClient,
} from "@/app/you/components/you-submenu-stack.client";

describe("You submenu stacked screens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists developer destinations in the stacked menu surface", () => {
    render(<YouDeveloperStackClient showDeveloperVendors={false} />);

    const screenRoot = screen.getByTestId("mobile-stacked-menu-screen");
    expect(screenRoot).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "developer" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("you-developer-docs")).toHaveAttribute(
      "href",
      "/developer/docs",
    );
    expect(screen.getByTestId("you-developer-oauthClients")).toHaveAttribute(
      "href",
      "/developer/oauth-clients",
    );
    expect(screen.queryByTestId("you-developer-vendors")).toBeNull();
    expect(screen.queryByTestId("you-buy-credits")).toBeNull();
    expect(screen.queryByTestId("you-logout")).toBeNull();
  });

  it("shows gated developer vendors when enabled", () => {
    render(<YouDeveloperStackClient showDeveloperVendors={true} />);

    expect(screen.getByTestId("you-developer-vendors")).toHaveAttribute(
      "href",
      "/developer/vendors",
    );
  });

  it("lists help actions that open shared help destinations", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<YouHelpStackClient />);

    expect(screen.getByRole("heading", { name: "help" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("you-help-documentation"));
    expect(openSpy).toHaveBeenCalledWith(
      "https://www.masumi.network/dev/sokosumi/documentation",
      "_blank",
      "noopener,noreferrer",
    );

    openSpy.mockRestore();
  });

  it("lists legal links and cookie consent on the Legal stack", () => {
    render(<YouLegalStackClient />);

    expect(screen.getByRole("heading", { name: "legal" })).toBeInTheDocument();
    expect(screen.getByTestId("you-legal-termsOfService")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("you-cookie-consent"));
    expect(openConsentPreferencesMock).toHaveBeenCalled();
  });
});
