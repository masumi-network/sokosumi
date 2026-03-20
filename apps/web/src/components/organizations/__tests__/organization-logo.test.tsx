import "@testing-library/jest-dom";
import { Organization } from "@sokosumi/database";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";

import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";

import { OrganizationLogo } from "@/components/organizations/organization-logo";

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));

jest.mock("@sokosumi/utils", () => {
  const actual =
    jest.requireActual<typeof import("@sokosumi/utils")>("@sokosumi/utils");
  return {
    ...actual,
    resolveIpfsOrHttpUrl: jest.fn(),
  };
});

const mockedResolveIpfsOrHttpUrl = jest.mocked(resolveIpfsOrHttpUrl);

function createOrganization(overrides: Partial<Organization>): Organization {
  return {
    name: "Acme",
    logo: null,
    url: null,
    ...overrides,
  } as unknown as Organization;
}

describe("OrganizationLogo", () => {
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
          url: "https://acme.example",
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
          url: "https://acme.example",
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
