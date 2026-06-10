import type { Member, Organization } from "@sokosumi/database";
import { MemberRole } from "@sokosumi/database";
import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";

import OrganizationInformation from "../organization-information";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => {
    const labels: Record<string, string> = {
      slugLabel: "Slug",
      stripeCustomerIdLabel: "Stripe customer ID",
      websiteLabel: "Website",
    };

    return labels[key] ?? key;
  },
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("../organization-edit-button", () => ({
  __esModule: true,
  default: () => <button type="button">Edit</button>,
}));

vi.mock("../organization-remove-button", () => ({
  __esModule: true,
  default: () => <button type="button">Delete</button>,
}));

vi.mock("@/components/organizations", () => ({
  OrganizationLogo: () => <span aria-hidden="true">Logo</span>,
}));

vi.mock("@/components/copyable-value", () => ({
  CopyableValue: ({ value }: { value: string }) => (
    <div>
      <span>{value}</span>
      <button type="button" aria-label="Copy">
        Copy
      </button>
    </div>
  ),
}));

vi.mock("@/components/design-md", () => ({
  DesignMdProfileSection: ({
    canManage,
    owner,
    value,
    websiteUrl,
  }: {
    canManage?: boolean;
    owner: { organizationId?: string; type: string };
    value?: {
      extractionId?: null | string;
      previewUrl?: null | string;
      url?: null | string;
    };
    websiteUrl?: null | string;
  }) => (
    <section
      data-testid="design-md-section"
      data-can-manage={String(canManage)}
      data-owner-id={owner.organizationId}
      data-owner-type={owner.type}
      data-preview-url={value?.previewUrl ?? ""}
      data-url={value?.url ?? ""}
      data-website-url={websiteUrl ?? ""}
    >
      DESIGN.md
    </section>
  ),
}));

vi.mock("@/lib/services/design-md.service", () => ({
  designMdService: {
    getDesignMdPreviewUrl: (extractionId: string | number) =>
      `https://www.masumi.example/tools/design-md?cached=${extractionId}`,
  },
}));

function createOrganization(
  overrides: Partial<Organization>,
): Organization & { _count: { members: number } } {
  return {
    id: "org_1",
    name: "Acme",
    slug: "acme",
    logo: null,
    metadata: null,
    stripeCustomerId: null,
    createdAt: new Date("2026-04-15T10:00:00.000Z"),
    _count: { members: 3 },
    ...overrides,
  };
}

function createMember(overrides: Partial<Member>): Member {
  return {
    id: "member_1",
    userId: "user_1",
    organizationId: "org_1",
    role: MemberRole.OWNER,
    createdAt: new Date("2026-04-15T10:00:00.000Z"),
    seatAssignedAt: null,
    ...overrides,
  };
}

describe("OrganizationInformation", () => {
  it("shows the organization name, slug, and Stripe customer ID in the overview", async () => {
    const view = await OrganizationInformation({
      organization: createOrganization({
        metadata: JSON.stringify({ url: "https://acme.example" }),
        stripeCustomerId: "cus_org_123",
      }),
      member: createMember({}),
    });

    render(view);

    expect(
      screen.getByRole("heading", { level: 1, name: "Acme" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Slug")).toBeInTheDocument();
    expect(screen.getByText("acme")).toBeInTheDocument();
    expect(screen.getByText("Stripe customer ID")).toBeInTheDocument();
    expect(screen.getByText("cus_org_123")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: "https://acme.example" }),
    ).toHaveAttribute("href", "https://acme.example");
    expect(screen.getByTestId("design-md-section")).toHaveAttribute(
      "data-can-manage",
      "true",
    );
    expect(screen.getByTestId("design-md-section")).toHaveAttribute(
      "data-owner-id",
      "org_1",
    );
    expect(screen.getByTestId("design-md-section")).toHaveAttribute(
      "data-website-url",
      "https://acme.example",
    );

    const websiteLabel = screen.getByText("Website");
    const stripeLabel = screen.getByText("Stripe customer ID");
    expect(
      websiteLabel.compareDocumentPosition(stripeLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the name and slug visible and hides the Stripe customer row when the ID is missing", async () => {
    const view = await OrganizationInformation({
      organization: createOrganization({}),
      member: createMember({ role: MemberRole.MEMBER }),
    });

    render(view);

    expect(
      screen.getByRole("heading", { level: 1, name: "Acme" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Slug")).toBeInTheDocument();
    expect(screen.getByText("acme")).toBeInTheDocument();
    expect(screen.queryByText("Stripe customer ID")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(1);
    expect(screen.getByTestId("design-md-section")).toHaveAttribute(
      "data-can-manage",
      "false",
    );
  });

  it("passes persisted organization DESIGN.md metadata to the shared section", async () => {
    const view = await OrganizationInformation({
      organization: createOrganization({
        metadata: JSON.stringify({
          designMdExtractionId: "42",
          designMdUrl: "https://blob.example/design.md",
          url: "https://acme.example",
        }),
      }),
      member: createMember({ role: MemberRole.ADMIN }),
    });

    render(view);

    expect(screen.getByTestId("design-md-section")).toHaveAttribute(
      "data-url",
      "https://blob.example/design.md",
    );
    expect(screen.getByTestId("design-md-section")).toHaveAttribute(
      "data-preview-url",
      "https://www.masumi.example/tools/design-md?cached=42",
    );
  });
});
