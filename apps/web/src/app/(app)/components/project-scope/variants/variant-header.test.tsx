import type { SessionUser } from "@sokosumi/utils";
import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScopeVariantId } from "./scope-variants";

interface SessionState {
  data: {
    user: { name: string; email: string };
    session: { activeOrganizationId: string | null };
  } | null;
  error: Error | null;
}

interface OrganizationsState {
  data: { id: string; name: string }[] | undefined;
  error: Error | null;
}

const mocks = vi.hoisted(() => ({
  pathname: "/",
  variant: "header" as ScopeVariantId,
  session: { data: null, error: null } as SessionState,
  organizations: { data: undefined, error: null } as OrganizationsState,
  projectId: null as string | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));
vi.mock("next/link", () => ({
  default: ({
    prefetch: _prefetch,
    ...props
  }: ComponentProps<"a"> & { prefetch?: boolean }) => <a {...props} />,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => mocks.session,
  authClient: { useListOrganizations: () => mocks.organizations },
}));
vi.mock("./use-scope-variant", () => ({
  useScopeVariant: () => mocks.variant,
}));
// The scope switch itself is not under test here; keep its data layer out.
vi.mock("@/app/components/project-scope/project-scope-menu", () => ({
  ProjectScopeMenu: () => null,
}));
vi.mock("@/app/components/project-scope/use-project-scope", async () => {
  const { scopedHref, switchScopeHref } = await vi.importActual<
    typeof import("@/app/components/project-scope/project-scope-href")
  >("@/app/components/project-scope/project-scope-href");
  return {
    useProjectScopeSwitch: () => ({
      projectId: mocks.projectId,
      hrefFor: (href: string) => scopedHref(href, mocks.projectId),
      switchHref: (projectId: string | null) =>
        switchScopeHref(mocks.pathname, projectId),
      select: vi.fn(),
      openCreate: vi.fn(),
      createDialog: null,
    }),
  };
});
vi.mock("@/app/components/project-scope/use-scope-projects", () => ({
  useSelectedScopeProject: () => null,
}));
vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: () => null,
}));
// The real workspace switch renders in the narrow-trailing test; keep its
// modal and actions out.
vi.mock("@/hooks/use-modal", () => ({
  default: () => ({ Component: null, showModal: vi.fn() }),
}));
vi.mock("@/lib/actions/workspace-gate/action", () => ({
  createPersonalWorkspaceAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// The workspace crumb's switch has its own tests; keep its router out.
vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({
    isPending: false,
    handleSelectWorkspace: vi.fn(),
  }),
}));

import HeaderWorkspaceSwitch from "@/app/components/header/header-workspace-switch.client";
import BreadcrumbNavigationClient from "@/components/breadcrumb-navigation/breadcrumb-navigation.client";

import {
  HeaderVariantCrumbs,
  HeaderVariantTrailing,
  headerSlots,
} from "./variant-header";

// What the server BreadcrumbNavigation hands the header, once resolved.
const SERVER_CRUMBS = (
  <BreadcrumbNavigationClient
    organizations={[]}
    breadcrumbMessages={{ tasks: "Tasks", agents: "Agents" }}
  />
);

/** sm and up, where the desktop breadcrumb and workspace crumb show. */
function stubSmUp() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function signInToAcme() {
  mocks.session = {
    data: {
      user: { name: "Ada", email: "ada@example.com" },
      session: { activeOrganizationId: "org-1" },
    },
    error: null,
  };
  mocks.organizations = {
    data: [{ id: "org-1", name: "Acme" }],
    error: null,
  };
}

const TASK_ID = "0b5c1c6e-6f9a-4e7b-9a53-1f0d2f3a4b5c";

/** The first crumb: a workspace switch that names the workspace. */
const WORKSPACE_SWITCH = "switchWorkspace Acme";

const CRUMB = "breadcrumb-item";
const SEPARATOR = "breadcrumb-separator";

/** The list's children in order: crumbs and the separators between them. */
function trail(nav: HTMLElement) {
  return Array.from(nav.querySelector("ol")?.children ?? [], (child) =>
    child.getAttribute("data-slot"),
  );
}

function renderCrumbs() {
  return render(<HeaderVariantCrumbs>{SERVER_CRUMBS}</HeaderVariantCrumbs>);
}

beforeEach(() => {
  mocks.pathname = "/";
  mocks.variant = "header";
  mocks.session = { data: null, error: null };
  mocks.organizations = { data: undefined, error: null };
  mocks.projectId = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HeaderVariantCrumbs breadcrumb", () => {
  beforeEach(() => {
    stubSmUp();
    signInToAcme();
  });

  function breadcrumb() {
    return screen.getByRole("navigation", { name: "breadcrumb" });
  }

  it("holds the workspace and scope, with no current page, on /", () => {
    renderCrumbs();

    const nav = breadcrumb();
    expect(within(nav).getByText("Acme")).toBeInTheDocument();
    expect(
      within(nav).getByTestId("project-scope-trigger"),
    ).not.toHaveAttribute("aria-current");
    expect(trail(nav)).toEqual([CRUMB, SEPARATOR, CRUMB]);
  });

  it("marks the scope as the current page on /projects", () => {
    mocks.pathname = "/projects";
    renderCrumbs();

    const nav = breadcrumb();
    expect(within(nav).getByText("Acme")).toBeInTheDocument();
    expect(within(nav).getByTestId("project-scope-trigger")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(trail(nav)).toEqual([CRUMB, SEPARATOR, CRUMB]);
  });

  it.each([["/projects/p1"], ["/projects/p1/unknown"]])(
    "marks the scope as the current page on %s",
    (pathname) => {
      mocks.pathname = pathname;
      mocks.projectId = "p1";
      renderCrumbs();

      const nav = breadcrumb();
      expect(
        within(nav).getByRole("button", { name: WORKSPACE_SWITCH }),
      ).toBeInTheDocument();
      expect(within(nav).getByTestId("project-scope-trigger")).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(trail(nav)).toEqual([CRUMB, SEPARATOR, CRUMB]);
    },
  );

  it.each([
    ["/projects/p1/calendar", "calendar"],
    ["/projects/p1/social", "social"],
    ["/projects/p1/edit", "edit"],
    ["/projects/p1/design-md/edit", "editor"],
  ])("holds workspace, scope and section on %s", (pathname, label) => {
    mocks.pathname = pathname;
    mocks.projectId = "p1";
    renderCrumbs();

    const nav = breadcrumb();
    expect(
      within(nav).getByRole("button", { name: WORKSPACE_SWITCH }),
    ).toBeInTheDocument();
    expect(
      within(nav).getByTestId("project-scope-trigger"),
    ).not.toHaveAttribute("aria-current");
    expect(within(nav).getByText(label)).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(trail(nav)).toEqual([CRUMB, SEPARATOR, CRUMB, SEPARATOR, CRUMB]);
  });

  it("lets a section crumb give way first, but not to a sliver", () => {
    mocks.pathname = "/projects/p1/calendar";
    mocks.projectId = "p1";
    renderCrumbs();

    const page = screen.getByText("calendar");
    expect(page).toHaveAttribute("data-slot", "breadcrumb-page");
    expect(page.closest("li")).toHaveClass("min-w-12", "shrink-[100]");
  });

  it("folds the server crumbs into one breadcrumb on a workspace page", () => {
    // /tasks?projectId=p1: the query does not reach the pathname.
    mocks.pathname = "/tasks";
    mocks.projectId = "p1";
    renderCrumbs();

    expect(
      screen.getAllByRole("navigation", { name: "breadcrumb" }),
    ).toHaveLength(1);
    const nav = breadcrumb();
    expect(nav).toBe(screen.getByTestId("project-scope-header"));
    expect(nav.querySelectorAll("ol")).toHaveLength(1);
    expect(
      within(nav).getByRole("button", { name: WORKSPACE_SWITCH }),
    ).toBeInTheDocument();
    expect(
      within(nav).getByTestId("project-scope-trigger"),
    ).toBeInTheDocument();
    expect(within(nav).getByText("Tasks")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(trail(nav)).toEqual([CRUMB, SEPARATOR, CRUMB, SEPARATOR, CRUMB]);
  });

  it("separates each server crumb once, with none after the last", () => {
    mocks.pathname = `/tasks/${TASK_ID}/edit`;
    mocks.projectId = "P1";
    renderCrumbs();

    expect(trail(breadcrumb())).toEqual([
      CRUMB,
      SEPARATOR,
      CRUMB,
      SEPARATOR,
      CRUMB,
      SEPARATOR,
      CRUMB,
    ]);
  });

  it("keeps the scope in the server crumbs' links", () => {
    mocks.pathname = `/tasks/${TASK_ID}/edit`;
    mocks.projectId = "P1";
    renderCrumbs();

    expect(
      within(breadcrumb()).getByRole("link", { name: "Tasks" }),
    ).toHaveAttribute("href", "/tasks?projectId=P1");
  });

  it("lets the server's current crumb give way first, then its middle crumbs", () => {
    mocks.pathname = "/agents";
    renderCrumbs();

    expect(screen.getByTestId("project-scope-header")).toHaveClass(
      "[&_ol]:min-w-0",
      "[&_li:last-child]:min-w-12",
      "[&_li:last-child]:shrink-[100]",
      "[&_[data-slot=breadcrumb-page]]:truncate",
      "[&_li:has(>[data-slot=breadcrumb-link])]:min-w-6",
      "[&_[data-slot=breadcrumb-link]]:truncate",
    );
  });

  it("truncates only the server's middle crumbs, not the workspace or scope", () => {
    mocks.pathname = `/tasks/${TASK_ID}/edit`;
    mocks.projectId = "P1";
    renderCrumbs();

    const middle = breadcrumb().querySelectorAll(
      "li:has(>[data-slot=breadcrumb-link])",
    );
    expect(Array.from(middle, (item) => item.textContent)).toEqual(["Tasks"]);
  });

  it("leaves the scope's own width alone when it ends the trail", () => {
    mocks.pathname = "/projects/p1";
    mocks.projectId = "p1";
    renderCrumbs();

    expect(screen.getByTestId("project-scope-header")).not.toHaveClass(
      "[&_li:last-child]:min-w-12",
    );
  });

  it("spaces the scope like the breadcrumb primitive", () => {
    mocks.pathname = "/agents";
    renderCrumbs();

    expect(screen.getByTestId("project-scope-header")).toHaveClass(
      "gap-1.5",
      "sm:gap-2.5",
    );
    expect(
      screen.getByTestId("project-scope-header").querySelector("ol"),
    ).toHaveClass("gap-1.5", "sm:gap-2.5");
  });

  it("renders the server crumbs unchanged for other variants", () => {
    mocks.variant = "command";
    mocks.pathname = "/tasks";
    renderCrumbs();

    expect(within(breadcrumb()).getByText("Tasks")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByTestId("project-scope-header")).toBeNull();
  });

  it("leaves the server crumbs' links alone for other variants", () => {
    mocks.variant = "command";
    mocks.pathname = `/tasks/${TASK_ID}/edit`;
    mocks.projectId = "P1";
    renderCrumbs();

    expect(
      within(breadcrumb()).getByRole("link", { name: "Tasks" }),
    ).toHaveAttribute("href", "/tasks");
  });
});

describe("HeaderVariantTrailing", () => {
  function renderTrailing() {
    return render(
      <HeaderVariantTrailing>
        <span data-testid="trailing-child" />
      </HeaderVariantTrailing>,
    );
  }

  it.each<ScopeVariantId>(["header", "command", "combined", "sidebar", "hub"])(
    "hides the workspace name below sm for %s",
    (variant) => {
      mocks.variant = variant;
      renderTrailing();

      const wrapper = screen.getByTestId("trailing-child").parentElement;
      expect(wrapper).toHaveClass("contents");
      expect(wrapper?.className).toContain(
        "max-sm:[&_[data-testid=header-workspace-chrome]_[data-slot=header-workspace-name]]:sr-only",
      );
    },
  );

  it("targets the real workspace switch's name", () => {
    const sessionUser: SessionUser = {
      id: "user-1",
      name: "Ada",
      email: "ada@example.com",
      emailVerified: true,
      image: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      termsAccepted: true,
      marketingOptIn: false,
    };
    const { container } = render(
      <HeaderVariantTrailing>
        <div data-testid="header-workspace-chrome">
          <HeaderWorkspaceSwitch
            sessionUser={sessionUser}
            members={[]}
            hasPersonalWorkspace
            activeOrganizationId={null}
            isPending={false}
            onSelectWorkspace={vi.fn()}
          />
        </div>
      </HeaderVariantTrailing>,
    );

    const name = container.querySelector(
      "[data-testid=header-workspace-chrome] [data-slot=header-workspace-name]",
    );
    expect(name).toHaveTextContent("Ada");
  });

  it("leaves the trailing chrome alone for current", () => {
    mocks.variant = "current";
    const { container } = renderTrailing();

    expect(screen.getByTestId("trailing-child").parentElement).toBe(container);
  });
});

describe("HeaderVariantCrumbs workspace crumb", () => {
  beforeEach(() => {
    stubSmUp();
    signInToAcme();
  });

  it.each([
    ["in a project", "/projects/p-1", "p-1"],
    ["in the workspace view", "/projects", null],
  ])(
    "makes the workspace crumb a workspace switch %s",
    (_case, pathname, projectId) => {
      mocks.pathname = pathname;
      mocks.projectId = projectId;
      renderCrumbs();

      const crumb = screen.getByRole("button", { name: WORKSPACE_SWITCH });
      expect(crumb).toHaveAttribute("aria-haspopup", "dialog");
      expect(crumb).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("link")).toBeNull();
    },
  );
});

describe("HeaderMobileScope", () => {
  const HeaderMobileScope = headerSlots["header-mobile"];
  if (!HeaderMobileScope) throw new Error("No header-mobile slot");

  it("renders the switcher on a workspace page", () => {
    mocks.pathname = "/tasks";
    render(<HeaderMobileScope />);

    expect(
      screen.getByTestId("project-scope-trigger-mobile"),
    ).toBeInTheDocument();
  });

  it("renders nothing on a chat room, whose toolbar owns the space", () => {
    mocks.pathname = "/chat/rooms/r-1";
    const { container } = render(<HeaderMobileScope />);

    expect(container).toBeEmptyDOMElement();
  });
});
