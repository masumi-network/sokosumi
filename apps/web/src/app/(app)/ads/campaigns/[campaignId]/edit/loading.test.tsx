import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

describe("AdsCampaignEditLoading", () => {
  it("announces loading once", async () => {
    const { default: AdsCampaignEditLoading } = await import("./loading");
    render(await AdsCampaignEditLoading());

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("App.Ads.loading");
  });
});
