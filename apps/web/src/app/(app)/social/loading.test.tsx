import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const search = vi.hoisted(() => ({ get: vi.fn(() => null as string | null) }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: search.get }),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

describe("SocialLoading", () => {
  beforeEach(() => {
    search.get.mockReturnValue(null);
  });

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

  it("draws a week of the calendar when the tab is calendar or missing", async () => {
    const { default: SocialLoading } = await import("./loading");
    const { container } = render(await SocialLoading());

    expect(screen.getByTestId("social-loading")).toHaveAttribute(
      "data-loading-tab",
      "calendar",
    );
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(20);
  });

  it("draws a post list when the tab is drafts", async () => {
    search.get.mockReturnValue("drafts");
    const { default: SocialLoading } = await import("./loading");
    render(await SocialLoading());

    expect(screen.getByTestId("social-loading")).toHaveAttribute(
      "data-loading-tab",
      "drafts",
    );
    expect(screen.getByRole("list").children).toHaveLength(4);
  });

  it("draws account rows when the tab is accounts", async () => {
    search.get.mockReturnValue("accounts");
    const { default: SocialLoading } = await import("./loading");
    render(await SocialLoading());

    expect(screen.getByTestId("social-loading")).toHaveAttribute(
      "data-loading-tab",
      "accounts",
    );
    expect(screen.getByRole("list").children).toHaveLength(3);
  });

  it("draws a post list when the tab is attention", async () => {
    search.get.mockReturnValue("attention");
    const { default: SocialLoading } = await import("./loading");
    render(await SocialLoading());

    expect(screen.getByTestId("social-loading")).toHaveAttribute(
      "data-loading-tab",
      "attention",
    );
    expect(screen.getByRole("list").children).toHaveLength(4);
  });

  it("draws statistic cards when the tab is statistics", async () => {
    search.get.mockReturnValue("statistics");
    const { default: SocialLoading } = await import("./loading");
    const { container } = render(await SocialLoading());

    expect(screen.getByTestId("social-loading")).toHaveAttribute(
      "data-loading-tab",
      "statistics",
    );
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(8);
  });

  it("falls back to the calendar when the tab is unknown", async () => {
    search.get.mockReturnValue("nope");
    const { default: SocialLoading } = await import("./loading");
    render(await SocialLoading());

    expect(screen.getByTestId("social-loading")).toHaveAttribute(
      "data-loading-tab",
      "calendar",
    );
  });
});
