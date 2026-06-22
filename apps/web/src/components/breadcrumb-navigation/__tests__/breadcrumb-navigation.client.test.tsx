import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BreadcrumbNavigationClient from "@/components/breadcrumb-navigation/breadcrumb-navigation.client";
import type {
  CoreAgentDto,
  OrganizationWithLimitedInfo,
} from "@/lib/types/core-dto";

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
  admin: "Admin",
  organizations: "Organizations",
  users: "Users",
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
        agents={[] as CoreAgentDto[]}
        organizations={organizations}
        breadcrumbMessages={breadcrumbMessages}
      />,
    );

    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.queryByText("Organizations")).not.toBeInTheDocument();
  });

  it("resolves agent names from agent id path segments", () => {
    usePathnameMock.mockReturnValue("/agents/agent-1");

    render(
      <BreadcrumbNavigationClient
        agents={
          [
            {
              id: "agent-1",
              name: "Research Copilot",
            },
          ] as CoreAgentDto[]
        }
        organizations={organizations}
        breadcrumbMessages={breadcrumbMessages}
      />,
    );

    expect(screen.getByText("Research Copilot")).toBeInTheDocument();
  });

  it("shows admin organizations list breadcrumbs", () => {
    usePathnameMock.mockReturnValue("/admin/organizations");

    render(
      <BreadcrumbNavigationClient
        agents={[] as CoreAgentDto[]}
        organizations={organizations}
        breadcrumbMessages={breadcrumbMessages}
      />,
    );

    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Organizations")).toBeInTheDocument();
  });

  it("shows admin organization detail breadcrumbs with resolved name", () => {
    usePathnameMock.mockReturnValue("/admin/organizations/acme-corp");

    render(
      <BreadcrumbNavigationClient
        agents={[] as CoreAgentDto[]}
        organizations={organizations}
        breadcrumbMessages={breadcrumbMessages}
        segmentLabels={{ "acme-corp": "Acme Corp" }}
      />,
    );

    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Organizations")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
  });

  it("shows admin users list breadcrumbs", () => {
    usePathnameMock.mockReturnValue("/admin/users");

    render(
      <BreadcrumbNavigationClient
        agents={[] as CoreAgentDto[]}
        organizations={organizations}
        breadcrumbMessages={breadcrumbMessages}
      />,
    );

    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.queryByText("users")).not.toBeInTheDocument();
  });
});
