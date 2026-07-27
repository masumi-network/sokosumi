import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BreadcrumbNavigationClient from "@/components/breadcrumb-navigation/breadcrumb-navigation.client";
import {
  BreadcrumbOverrideProvider,
  useRegisterBreadcrumbOverride,
} from "@/contexts/breadcrumb-override-context";
import type { OrganizationWithLimitedInfo } from "@/lib/types/core-dto";

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
  account: "Account",
  editor: "Editor",
  chat: "Chat",
};

function BreadcrumbOverrideFixture({ label }: { label: string }) {
  useRegisterBreadcrumbOverride({
    pathname: "/channels",
    segments: [
      {
        label: "Chat",
        href: "/chat",
      },
      {
        label,
        href: "/channels?channel=direct-1",
      },
    ],
  });

  return (
    <BreadcrumbNavigationClient
      organizations={organizations}
      breadcrumbMessages={breadcrumbMessages}
      segmentLabels={{
        __chatChannelLabel: "Test Channel",
        __chatChannelHref: "/channels?channel=stale-channel",
      }}
    />
  );
}

function ChatBucketBreadcrumbFixture({
  pathname,
  label,
}: {
  pathname: string;
  label: string;
}) {
  useRegisterBreadcrumbOverride({
    pathname,
    segments: [
      {
        label: "Chat",
        href: "/chat",
      },
      {
        label,
        href: "/chat/elena",
      },
    ],
  });

  return (
    <BreadcrumbNavigationClient
      organizations={organizations}
      breadcrumbMessages={breadcrumbMessages}
    />
  );
}

describe("BreadcrumbNavigationClient", () => {
  beforeEach(() => {
    usePathnameMock.mockReset();
  });

  it("shows only the organization name on organization detail pages", () => {
    usePathnameMock.mockReturnValue("/organizations/acme-corp");

    render(
      <BreadcrumbNavigationClient
        organizations={organizations}
        breadcrumbMessages={breadcrumbMessages}
      />,
    );

    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.queryByText("Organizations")).not.toBeInTheDocument();
  });

  it("resolves agent path segments from segmentLabels", () => {
    usePathnameMock.mockReturnValue("/agents/agent-1");

    render(
      <BreadcrumbNavigationClient
        organizations={organizations}
        breadcrumbMessages={breadcrumbMessages}
        segmentLabels={{ "agent-1": "Research Copilot" }}
      />,
    );

    expect(screen.getByText("Research Copilot")).toBeInTheDocument();
  });

  it("shows selected chat channel under Chat breadcrumbs", () => {
    usePathnameMock.mockReturnValue("/channels");

    render(
      <BreadcrumbNavigationClient
        organizations={organizations}
        breadcrumbMessages={breadcrumbMessages}
        segmentLabels={{
          __chatChannelLabel: "Test Channel",
          __chatChannelHref: "/channels?channel=channel-1",
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute(
      "href",
      "/chat",
    );
    expect(screen.getByText("Test Channel")).toBeInTheDocument();
    expect(screen.queryByText("channels")).not.toBeInTheDocument();
  });

  it("uses registered channel breadcrumb over stale server labels", async () => {
    usePathnameMock.mockReturnValue("/channels");

    render(
      <BreadcrumbOverrideProvider>
        <BreadcrumbOverrideFixture label="Andreas" />
      </BreadcrumbOverrideProvider>,
    );

    expect(await screen.findByText("Andreas")).toBeInTheDocument();
    expect(screen.queryByText("Test Channel")).not.toBeInTheDocument();
  });

  it("uses coworker display name instead of URL slug on chat bucket routes", async () => {
    usePathnameMock.mockReturnValue(
      "/chat/elena/conversation/11111111-1111-4111-8111-111111111111",
    );

    render(
      <BreadcrumbOverrideProvider>
        <ChatBucketBreadcrumbFixture
          pathname="/chat/elena/conversation/11111111-1111-4111-8111-111111111111"
          label="Elena"
        />
      </BreadcrumbOverrideProvider>,
    );

    expect(await screen.findByText("Elena")).toBeInTheDocument();
    expect(screen.queryByText("elena")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute(
      "href",
      "/chat",
    );
  });

  it("shows raw chat bucket slug when no override is registered", () => {
    usePathnameMock.mockReturnValue(
      "/chat/elena/conversation/11111111-1111-4111-8111-111111111111",
    );

    render(
      <BreadcrumbNavigationClient
        organizations={organizations}
        breadcrumbMessages={breadcrumbMessages}
      />,
    );

    expect(screen.getByText("elena")).toBeInTheDocument();
  });

  it("shows admin organizations list breadcrumbs", () => {
    usePathnameMock.mockReturnValue("/admin/organizations");

    render(
      <BreadcrumbNavigationClient
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
        organizations={organizations}
        breadcrumbMessages={breadcrumbMessages}
        segmentLabels={{ "acme-corp": "Acme Corp" }}
      />,
    );

    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Organizations")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
  });

  it("shows account design-md editor breadcrumbs without design-md segment", () => {
    usePathnameMock.mockReturnValue("/account/design-md/edit");

    render(
      <BreadcrumbNavigationClient
        organizations={organizations}
        breadcrumbMessages={breadcrumbMessages}
      />,
    );

    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("Editor")).toBeInTheDocument();
    expect(screen.queryByText("design-md")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
  });

  it("shows admin users list breadcrumbs", () => {
    usePathnameMock.mockReturnValue("/admin/users");

    render(
      <BreadcrumbNavigationClient
        organizations={organizations}
        breadcrumbMessages={breadcrumbMessages}
      />,
    );

    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.queryByText("users")).not.toBeInTheDocument();
  });

  it("shows developer vendor detail breadcrumbs with resolved name", () => {
    const vendorId = "01960001-0001-7001-8001-000000000001";
    usePathnameMock.mockReturnValue(`/developer/vendors/${vendorId}`);

    render(
      <BreadcrumbNavigationClient
        organizations={organizations}
        breadcrumbMessages={{
          ...breadcrumbMessages,
          developer: "Developer",
          vendors: "Vendors",
        }}
        segmentLabels={{ [vendorId]: "Masumi" }}
      />,
    );

    expect(screen.getByText("Developer")).toBeInTheDocument();
    expect(screen.getByText("Vendors")).toBeInTheDocument();
    expect(screen.getByText("Masumi")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vendors" })).toHaveAttribute(
      "href",
      "/developer/vendors",
    );
  });

  it("hides unresolved vendor uuid segments from breadcrumbs", () => {
    const vendorId = "01960001-0001-7001-8001-000000000001";
    usePathnameMock.mockReturnValue(`/developer/vendors/${vendorId}`);

    render(
      <BreadcrumbNavigationClient
        organizations={organizations}
        breadcrumbMessages={{
          ...breadcrumbMessages,
          developer: "Developer",
          vendors: "Vendors",
        }}
      />,
    );

    expect(screen.getByText("Developer")).toBeInTheDocument();
    expect(screen.getByText("Vendors")).toBeInTheDocument();
    expect(screen.queryByText(vendorId)).not.toBeInTheDocument();
  });
});
