import type { UserWorkspace } from "@sokosumi/core-client";
import type { SessionUser } from "@sokosumi/utils";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSwitcherProvider } from "@/app/components/workspace-switcher/workspace-switcher.client";
import WorkspaceSwitcherMenu from "@/app/components/workspace-switcher/workspace-switcher-menu.client";

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useWorkspaceSwitcher: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => mocks.useSession(),
}));

vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => mocks.useWorkspaceSwitcher(),
}));

// The wizard is its own seam; here only how many of it mount matters.
vi.mock(
  "@/components/organizations/create-organization-wizard/create-organization-wizard",
  () => ({
    CreateOrganizationWizard: () => (
      <div data-testid="create-organization-wizard" />
    ),
  }),
);

const sessionUser: SessionUser = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  emailVerified: true,
  image: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  termsAccepted: true,
  marketingOptIn: false,
};

function organization(id: string, name: string): UserWorkspace {
  return {
    id: `ws-${id}`,
    kind: "organization",
    name,
    organizationId: id,
    slug: id,
    logo: null,
    websiteUrl: null,
    preferred: false,
    enabledSocialProviders: [],
  };
}

const workspaces = [
  organization("org-a", "Org A"),
  organization("org-b", "Org B"),
];

/** Both placements, as the app chrome mounts them: CSS shows one. */
function renderChrome(activeOrganizationId: string | null = "org-a") {
  return render(
    <WorkspaceSwitcherProvider
      sessionUser={sessionUser}
      workspaces={workspaces}
      activeOrganizationId={activeOrganizationId}
    >
      <aside data-testid="sidebar">
        <WorkspaceSwitcherMenu placement="sidebar" />
      </aside>
      <header data-testid="top-bar">
        <WorkspaceSwitcherMenu placement="topBar" />
      </header>
    </WorkspaceSwitcherProvider>,
  );
}

function trigger(placement: "sidebar" | "top-bar") {
  return within(screen.getByTestId(placement)).getByRole("button");
}

function menuItems(): string[] {
  return within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map((item) => item.textContent ?? "");
}

describe("WorkspaceSwitcherProvider", () => {
  beforeEach(() => {
    mocks.useSession.mockReturnValue({
      data: { session: { activeOrganizationId: "org-a" } },
    });
    mocks.useWorkspaceSwitcher.mockReturnValue({
      isPending: false,
      handleSelectWorkspace: vi.fn(),
    });
  });

  // One owner: both triggers are on the page, but the create dialog and the
  // organization wizard behind them exist once.
  it("mounts one organization wizard for both placements", () => {
    renderChrome();

    expect(trigger("sidebar")).toHaveAccessibleName("Org A");
    expect(trigger("top-bar")).toHaveAccessibleName("Org A");
    expect(screen.getAllByTestId("create-organization-wizard")).toHaveLength(1);
  });

  it("opens one create dialog whichever placement asked for it", async () => {
    const user = userEvent.setup();
    renderChrome();

    await user.click(trigger("top-bar"));
    await user.click(screen.getByRole("menuitem", { name: /createWorkspace/ }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen.getByTestId("workspace-switcher-create-choice"),
    ).toBeInTheDocument();
  });

  it("opens the same menu from either placement, one at a time", async () => {
    const user = userEvent.setup();
    renderChrome();

    await user.click(trigger("sidebar"));
    const fromSidebar = menuItems();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();

    await user.click(trigger("top-bar"));
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(menuItems()).toEqual(fromSidebar);
    expect(fromSidebar).toEqual(["Org A", "Org B", "createWorkspace"]);
  });

  // Under the trigger's own edge: its start in the sidebar, its end at the
  // top bar's right. The placement says which, not the viewport.
  it.each([
    ["sidebar", "start"],
    ["top-bar", "end"],
  ] as const)("aligns the %s menu to its %s", async (placement, align) => {
    const user = userEvent.setup();
    renderChrome();

    await user.click(trigger(placement));

    expect(screen.getByRole("menu")).toHaveAttribute("data-align", align);
  });

  it("shows the name in the sidebar, and only reads it out in the top bar", () => {
    renderChrome();

    const sidebarName = within(trigger("sidebar")).getByText("Org A");
    const topBarName = within(trigger("top-bar")).getByText("Org A");

    expect(sidebarName.className.split(/\s+/)).not.toContain("sr-only");
    // The phone/desktop split is md (MOBILE_BREAKPOINT 768): the top bar
    // shows the avatar alone up to it.
    expect(topBarName.className.split(/\s+/)).toContain("max-md:sr-only");
  });

  // As in Linear: the sidebar's switcher is a pill as wide as its content.
  // Both placements carry the switch arrows the project title uses, so the
  // two pickers read alike.
  it("gives the sidebar trigger the switch arrows and its content's width", () => {
    renderChrome();

    expect(
      trigger("sidebar").querySelector("svg.lucide-chevrons-up-down"),
    ).not.toBeNull();
    expect(trigger("sidebar").className.split(/\s+/)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/(^|:)w-full$/)]),
    );
    expect(
      trigger("top-bar").querySelector("svg.lucide-chevrons-up-down"),
    ).not.toBeNull();
  });

  it("prefers the client session's active organization over the server's", () => {
    mocks.useSession.mockReturnValue({
      data: { session: { activeOrganizationId: "org-b" } },
    });

    renderChrome("org-a");

    expect(trigger("sidebar")).toHaveAccessibleName("Org B");
  });

  it("falls back to the server's active organization without a client session", () => {
    mocks.useSession.mockReturnValue({ data: null });

    renderChrome("org-b");

    expect(trigger("sidebar")).toHaveAccessibleName("Org B");
  });

  it("keeps the server's active organization while a switch is pending", () => {
    mocks.useSession.mockReturnValue({
      data: { session: { activeOrganizationId: "org-b" } },
    });
    mocks.useWorkspaceSwitcher.mockReturnValue({
      isPending: true,
      handleSelectWorkspace: vi.fn(),
    });

    renderChrome("org-a");

    expect(trigger("sidebar")).toHaveAccessibleName("Org A");
    expect(trigger("top-bar")).toBeDisabled();
  });
});
