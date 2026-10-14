import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import {
  BreadcrumbOverrideProvider,
  useBreadcrumbOverride,
} from "@/contexts/breadcrumb-override-context";
import messages from "../../../../../messages/en.json";
import { AdsCampaignBreadcrumb } from "./ads-campaign-breadcrumb";

const { pathnameMock } = vi.hoisted(() => ({ pathnameMock: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));

function Shown() {
  const override = useBreadcrumbOverride();
  return <p data-testid="trail">{JSON.stringify(override)}</p>;
}

function renderTrail(editHref?: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BreadcrumbOverrideProvider>
        <AdsCampaignBreadcrumb
          adsHref="/ads?projectId=p1&tab=campaigns&account=a1"
          detailsHref="/ads/campaigns/42?projectId=p1"
          editHref={editHref}
          name="Spring sale"
        />
        <Shown />
      </BreadcrumbOverrideProvider>
    </NextIntlClientProvider>,
  );
}

const trail = (container: HTMLElement) =>
  JSON.parse(container.querySelector("[data-testid=trail]")?.textContent ?? "");

describe("AdsCampaignBreadcrumb", () => {
  it("names the campaign instead of its numeric id", () => {
    pathnameMock.mockReturnValue("/ads/campaigns/42");
    const { container } = renderTrail();

    expect(trail(container)).toEqual({
      pathname: "/ads/campaigns/42",
      segments: [
        { label: "Ads", href: "/ads?projectId=p1&tab=campaigns&account=a1" },
        { label: "Spring sale", href: "/ads/campaigns/42?projectId=p1" },
      ],
    });
  });

  it("ends the edit page's trail with Edit", () => {
    pathnameMock.mockReturnValue("/ads/campaigns/42/edit");
    const { container } = renderTrail("/ads/campaigns/42/edit?projectId=p1");

    expect(
      trail(container).segments.map(({ label }: { label: string }) => label),
    ).toEqual(["Ads", "Spring sale", "Edit"]);
  });
});
