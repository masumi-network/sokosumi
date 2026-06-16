import type { Organization } from "@sokosumi/utils";
import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationLogo } from "@/components/organizations/organization-logo";
import { stubPendingImageLoad } from "@/test/stub-pending-image-load";

vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));

vi.mock("@sokosumi/utils", async () => {
  const actual =
    await vi.importActual<typeof import("@sokosumi/utils")>("@sokosumi/utils");
  return {
    ...actual,
    resolveIpfsOrHttpUrl: vi.fn(),
  };
});

const mockedResolveIpfsOrHttpUrl = vi.mocked(resolveIpfsOrHttpUrl);

function createOrganization(overrides: Partial<Organization>): Organization {
  return {
    name: "Acme",
    logo: null,
    metadata: null,
    ...overrides,
  } as unknown as Organization;
}

describe("OrganizationLogo", () => {
  stubPendingImageLoad();

  beforeEach(() => {
    mockedResolveIpfsOrHttpUrl.mockReset();
  });

  it("prefers the uploaded organization logo over favicon sources", () => {
    mockedResolveIpfsOrHttpUrl.mockReturnValue(
      "https://cdn.example/acme-logo.png",
    );

    render(
      <OrganizationLogo
        organization={createOrganization({
          logo: "ipfs://acme-logo",
          metadata: JSON.stringify({ url: "https://acme.example" }),
        })}
      />,
    );

    const image = screen.getByRole("img", { name: "Acme" });
    expect(image.getAttribute("src")).toBe("https://cdn.example/acme-logo.png");
  });

  it("uses favicon when available and falls back to Building2 when all fail", () => {
    const { container } = render(
      <OrganizationLogo
        organization={createOrganization({
          metadata: JSON.stringify({ url: "https://acme.example" }),
        })}
      />,
    );

    const firstAttempt = screen.getByRole("img", { name: "Acme" });
    expect(firstAttempt.getAttribute("src")).toBe(
      "https://acme.example/favicon.ico",
    );
    expect(container.querySelector('svg[data-lucide="building-2"]')).toBeNull();

    for (let index = 0; index < 4; index += 1) {
      const currentAttempt = screen.queryByRole("img", { name: "Acme" });
      if (!currentAttempt) break;
      fireEvent.error(currentAttempt);
    }

    expect(screen.queryByRole("img", { name: "Acme" })).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
