import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lazyAblyProviderMock = vi.fn(
  ({ children }: { children: React.ReactNode }) => (
    <div data-testid="lazy-ably-island">{children}</div>
  ),
);

vi.mock("@/contexts/lazy-ably-provider", () => ({
  default: (props: { children: React.ReactNode }) =>
    lazyAblyProviderMock(props),
}));

vi.mock("@/lib/ably/use-org-presence-publisher", () => ({
  useOrgPresencePublisher: vi.fn(),
}));

const stableLiveMap = new Map([["user_live", "online" as const]]);

vi.mock("@/lib/ably/use-org-presence-map", () => ({
  useOrgPresenceMap: vi.fn(() => stableLiveMap),
}));

import {
  OrgPresenceProvider,
  useMemberPresence,
} from "@/contexts/org-presence-provider";
import { useOrgPresencePublisher } from "@/lib/ably/use-org-presence-publisher";

function PresenceProbe({
  userId,
  fallback,
}: {
  userId: string;
  fallback: "online" | "afk" | "offline";
}) {
  const presence = useMemberPresence(userId, fallback);
  return <span data-testid="presence">{presence}</span>;
}

describe("OrgPresenceProvider", () => {
  beforeEach(() => {
    lazyAblyProviderMock.mockClear();
    vi.mocked(useOrgPresencePublisher).mockClear();
  });

  it("passes the active organization to the presence publisher", () => {
    render(
      <OrgPresenceProvider organizationId="org_1">
        <div />
      </OrgPresenceProvider>,
    );

    expect(useOrgPresencePublisher).toHaveBeenCalledWith("org_1");
  });

  it("passes null to the presence publisher for a personal workspace", () => {
    render(
      <OrgPresenceProvider organizationId={null}>
        <div />
      </OrgPresenceProvider>,
    );

    expect(useOrgPresencePublisher).toHaveBeenCalledWith(null);
  });

  it("keeps paint-critical children outside the LazyAbly island", () => {
    render(
      <OrgPresenceProvider organizationId="org_1">
        <div data-testid="paint-critical">shell</div>
      </OrgPresenceProvider>,
    );

    const shell = screen.getByTestId("paint-critical");
    const island = screen.getByTestId("lazy-ably-island");
    expect(shell).toBeInTheDocument();
    expect(island).toBeInTheDocument();
    expect(island.contains(shell)).toBe(false);
    expect(shell.parentElement?.contains(island)).toBe(true);
  });

  it("uses REST fallback until Ably map has the user", () => {
    render(
      <OrgPresenceProvider organizationId="org_1">
        <PresenceProbe userId="self" fallback="online" />
      </OrgPresenceProvider>,
    );

    expect(screen.getByTestId("presence")).toHaveTextContent("online");
  });

  it("prefers live map when user is present", async () => {
    render(
      <OrgPresenceProvider organizationId="org_1">
        <PresenceProbe userId="user_live" fallback="offline" />
      </OrgPresenceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("presence")).toHaveTextContent("online");
    });
  });
});
