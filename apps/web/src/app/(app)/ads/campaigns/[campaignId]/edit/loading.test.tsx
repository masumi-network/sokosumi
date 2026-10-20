import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../../../../../messages/en.json";

vi.mock("next/navigation", () => ({
  usePathname: () => "/ads/campaigns/42/edit",
  useRouter: () => ({ replace: vi.fn() }),
}));

describe.each([
  ["the edit route", "./loading"],
  ["the details page's modal", "../@modal/(.)edit/loading"],
])("AdsCampaignEditLoading from %s", (_name, path) => {
  it("shows the edit modal's shape and announces loading once", async () => {
    const { default: AdsCampaignEditLoading } = await import(path);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AdsCampaignEditLoading />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("dialog", { name: "Edit campaign" })).toBeVisible();
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Loading");
  });
});
