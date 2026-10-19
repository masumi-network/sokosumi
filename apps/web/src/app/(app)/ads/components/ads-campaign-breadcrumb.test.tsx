import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  BreadcrumbOverrideProvider,
  useBreadcrumbOverride,
} from "@/contexts/breadcrumb-override-context";
import messages from "../../../../../messages/en.json";
import { AdsCampaignBreadcrumb } from "./ads-campaign-breadcrumb";

const { pathnameMock } = vi.hoisted(() => ({ pathnameMock: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));

const ADS_HREF = "/ads?projectId=p1&tab=campaigns&account=a1";
const CAMPAIGN = {
  name: "Spring sale",
  href: "/ads/campaigns/42?projectId=p1",
};

function Shown() {
  const override = useBreadcrumbOverride();
  return <p data-testid="trail">{JSON.stringify(override)}</p>;
}

function renderTrail(
  pathname: string,
  props: Partial<ComponentProps<typeof AdsCampaignBreadcrumb>> = {},
) {
  pathnameMock.mockReturnValue(pathname);
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BreadcrumbOverrideProvider>
        <AdsCampaignBreadcrumb adsHref={ADS_HREF} {...props} />
        <Shown />
      </BreadcrumbOverrideProvider>
    </NextIntlClientProvider>,
  );
  return JSON.parse(
    container.querySelector("[data-testid=trail]")?.textContent ?? "",
  );
}

describe("AdsCampaignBreadcrumb", () => {
  it("names the campaign instead of its numeric id", () => {
    expect(renderTrail("/ads/campaigns/42", { campaign: CAMPAIGN })).toEqual({
      pathname: "/ads/campaigns/42",
      segments: [
        { label: "Ads", href: ADS_HREF },
        { label: "Spring sale", href: CAMPAIGN.href },
      ],
    });
  });

  it("ends the edit page's trail with Edit", () => {
    const { segments } = renderTrail("/ads/campaigns/42/edit", {
      campaign: CAMPAIGN,
      page: { label: "edit", href: "/ads/campaigns/42/edit?projectId=p1" },
    });

    expect(segments.map(({ label }: { label: string }) => label)).toEqual([
      "Ads",
      "Spring sale",
      "Edit",
    ]);
  });

  // The path alone has no project: "campaigns" is no page and the ids lose
  // the query, so every ads page gives its whole trail.
  it("leads back to Ads when the campaign could not be loaded", () => {
    expect(renderTrail("/ads/campaigns/42").segments).toEqual([
      { label: "Ads", href: ADS_HREF },
    ]);
  });
});
