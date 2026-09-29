import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

describe("SocialLoading", () => {
  it("announces loading once and hides the placeholder blocks", async () => {
    const { default: SocialLoading } = await import("./loading");
    render(await SocialLoading());

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("App.Social.loading");
    // The page's outline still starts at its hidden h1.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "App.Social.title",
    );
  });

  it("draws a week of the calendar with placeholder posts", async () => {
    const { default: SocialLoading } = await import("./loading");
    const { container } = render(await SocialLoading());

    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(20);
  });
});
