import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

describe("AdsLoading", () => {
  it("announces loading once under the page title", async () => {
    const { default: AdsLoading } = await import("./loading");
    render(await AdsLoading());

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("App.Ads.loading");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "App.Ads.title",
    );
  });
});
