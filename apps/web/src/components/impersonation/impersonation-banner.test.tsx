import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImpersonationBanner } from "./impersonation-banner";

vi.mock("next-intl/server", () => ({
  getTranslations:
    async () => (key: string, values?: Record<string, string>) => {
      if (key === "banner" && values) {
        return `banner:${values.name}:${values.email}`;
      }
      return key;
    },
}));

vi.mock("./impersonation-banner-exit.client", () => ({
  ImpersonationBannerExit: ({
    label,
    errorMessage,
  }: {
    label: string;
    errorMessage: string;
  }) => (
    <button type="button" data-error-message={errorMessage}>
      {label}
    </button>
  ),
}));

describe("ImpersonationBanner", () => {
  it("shows the target identity with an Exit control while impersonating", async () => {
    render(
      await ImpersonationBanner({
        name: "Ada Lovelace",
        email: "ada@example.com",
        impersonatedBy: "user_admin",
      }),
    );

    expect(
      screen.getByText("banner:Ada Lovelace:ada@example.com"),
    ).toBeInTheDocument();
    const exitButton = screen.getByRole("button", { name: "exit" });
    expect(exitButton).toBeInTheDocument();
    expect(exitButton).toHaveAttribute("data-error-message", "stopError");
  });

  it.each([{ impersonatedBy: null }, { impersonatedBy: undefined }])(
    "renders nothing without the impersonation marker ($impersonatedBy)",
    async ({ impersonatedBy }) => {
      const { container } = render(
        await ImpersonationBanner({
          name: "Ada Lovelace",
          email: "ada@example.com",
          impersonatedBy,
        }),
      );

      expect(container).toBeEmptyDOMElement();
      expect(
        screen.queryByTestId("impersonation-banner"),
      ).not.toBeInTheDocument();
    },
  );
});
