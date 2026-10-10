import type { ProjectSocialConnection } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SimplifiedSocialComposer } from "./simplified-social-composer";

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    dateTime: (date: Date) => date.toISOString(),
  }),
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      session: {
        activeOrganizationId: "test-org",
      },
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const mockConnections: ProjectSocialConnection[] = [
  {
    id: "conn-1",
    provider: "x",
    status: "active",
    externalHandle: "@testuser",
    displayName: "Test User",
    avatarUrl: null,
    connectedAt: new Date(),
    disconnectedAt: null,
  },
];

describe("SimplifiedSocialComposer", () => {
  it("renders in create mode", () => {
    const onError = vi.fn();
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();

    render(
      <SimplifiedSocialComposer
        connections={mockConnections}
        mode={{ kind: "create" }}
        onError={onError}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
        open={true}
        projectId="test-project"
      />,
    );

    expect(screen.getByText("composer.newTitle")).toBeInTheDocument();
  });

  it("defaults to all active connections selected", () => {
    const onError = vi.fn();
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();

    render(
      <SimplifiedSocialComposer
        connections={mockConnections}
        mode={{ kind: "create" }}
        onError={onError}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
        open={true}
        projectId="test-project"
      />,
    );

    expect(screen.getByText("@testuser")).toBeInTheDocument();
  });

  it("defaults to post now mode", () => {
    const onError = vi.fn();
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();

    render(
      <SimplifiedSocialComposer
        connections={mockConnections}
        mode={{ kind: "create" }}
        onError={onError}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
        open={true}
        projectId="test-project"
      />,
    );

    expect(screen.getByText("composer.postNow")).toBeInTheDocument();
  });
});
