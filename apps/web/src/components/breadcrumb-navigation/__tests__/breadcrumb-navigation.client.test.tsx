import type {
  AgentWithRelations,
  OrganizationWithLimitedInfo,
} from "@sokosumi/utils";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BreadcrumbNavigationClient from "@/components/breadcrumb-navigation/breadcrumb-navigation.client";

const usePathnameMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const organizations: OrganizationWithLimitedInfo[] = [
  {
    id: "org-1",
    name: "Acme Corp",
    slug: "acme-corp",
  },
];

const breadcrumbMessages = {
  organizations: "Organizations",
  agents: "Agents",
};

describe("BreadcrumbNavigationClient", () => {
  beforeEach(() => {
    usePathnameMock.mockReset();
  });

  it("shows only the organization name on organization detail pages", () => {
    usePathnameMock.mockReturnValue("/organizations/acme-corp");

    render(
      <BreadcrumbNavigationClient
        agents={[] as AgentWithRelations[]}
        organizations={organizations}
        breadcrumbMessages={breadcrumbMessages}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Acme Corp", current: "page" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Organizations")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Organizations" }),
    ).not.toBeInTheDocument();
  });

  it("does not show an organizations breadcrumb for the removed overview route", () => {
    usePathnameMock.mockReturnValue("/organizations");

    render(
      <BreadcrumbNavigationClient
        agents={[] as AgentWithRelations[]}
        organizations={organizations}
        breadcrumbMessages={breadcrumbMessages}
      />,
    );

    expect(screen.queryByText("Organizations")).not.toBeInTheDocument();
  });
});
