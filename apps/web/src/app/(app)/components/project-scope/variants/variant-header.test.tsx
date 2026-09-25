import { render, renderHook, screen } from "@testing-library/react";
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
vi.mock("@/app/components/project-scope/use-project-scope", () => ({
  useProjectScopeSwitch: () => ({
    projectId: mocks.projectId,
    switchHref: (projectId: string | null) =>
      projectId ? `/projects/${projectId}` : "/projects",
    select: vi.fn(),
    openCreate: vi.fn(),
    createDialog: null,
  }),
}));
vi.mock("@/app/components/project-scope/use-scope-projects", () => ({
  useSelectedScopeProject: () => null,
}));
vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: () => null,
}));

import {
  HeaderVariantCrumbs,
  HeaderVariantTrailing,
  headerSlots,
  useWorkspaceName,
} from "./variant-header";

const SERVER_CRUMBS = <nav data-testid="server-crumbs">crumbs</nav>;

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

describe("HeaderVariantCrumbs trail", () => {
  it.each([["/"], ["/projects"], ["/projects/p1"], ["/projects/p1/unknown"]])(
    "renders no trail on %s",
    (pathname) => {
      mocks.pathname = pathname;
      renderCrumbs();

      expect(screen.queryByTestId("project-scope-header-trail")).toBeNull();
      expect(screen.queryByTestId("server-crumbs")).toBeNull();
    },
  );

  it.each([
    ["/projects/p1/calendar", "calendar"],
    ["/projects/p1/social", "social"],
    ["/projects/p1/edit", "edit"],
    ["/projects/p1/design-md/edit", "editor"],
  ])("names the project section on %s", (pathname, label) => {
    mocks.pathname = pathname;
    renderCrumbs();

    const trail = screen.getByTestId("project-scope-header-trail");
    expect(trail).toHaveTextContent(label);
    expect(screen.getByText(label)).toHaveAttribute("aria-current", "page");
    expect(screen.queryByTestId("server-crumbs")).toBeNull();
  });

  it("keeps the server crumbs on a page outside a project", () => {
    mocks.pathname = "/agents";
    renderCrumbs();

    const trail = screen.getByTestId("project-scope-header-trail");
    expect(trail).toContainElement(screen.getByTestId("server-crumbs"));
  });

  it("lets only the current page's crumb shrink, with an ellipsis", () => {
    mocks.pathname = "/agents";
    renderCrumbs();

    const trail = screen.getByTestId("project-scope-header-trail");
    expect(trail).toHaveClass(
      "[&_ol]:min-w-0",
      "[&_li:last-child]:min-w-0",
      "[&_[data-slot=breadcrumb-page]]:truncate",
    );
  });

  it("renders the server crumbs unchanged for other variants", () => {
    mocks.variant = "command";
    mocks.pathname = "/projects/p1/calendar";
    renderCrumbs();

    expect(screen.getByTestId("server-crumbs")).toBeInTheDocument();
    expect(screen.queryByTestId("project-scope-header-trail")).toBeNull();
  });
});

describe("useWorkspaceName", () => {
  function session(activeOrganizationId: string | null, name = "Ada") {
    return {
      data: {
        user: { name, email: "ada@example.com" },
        session: { activeOrganizationId },
      },
      error: null,
    };
  }

  it("waits while the session loads", () => {
    const { result } = renderHook(() => useWorkspaceName());
    expect(result.current).toBeNull();
  });

  it("falls back to the generic name when the session fails", () => {
    mocks.session = { data: null, error: new Error("offline") };
    const { result } = renderHook(() => useWorkspaceName());
    expect(result.current).toBe("workspace");
  });

  it("names the personal account after the user", () => {
    mocks.session = session(null);
    const { result } = renderHook(() => useWorkspaceName());
    expect(result.current).toBe("Ada");
  });

  it("falls back to the email, then the personal account label", () => {
    mocks.session = session(null, "");
    const { result, rerender } = renderHook(() => useWorkspaceName());
    expect(result.current).toBe("ada@example.com");

    mocks.session = {
      data: {
        user: { name: "", email: "" },
        session: { activeOrganizationId: null },
      },
      error: null,
    };
    rerender();
    expect(result.current).toBe("personalAccount");
  });

  it("names the active organization from the list", () => {
    mocks.session = session("org-1");
    mocks.organizations = {
      data: [{ id: "org-1", name: "Acme" }],
      error: null,
    };
    const { result } = renderHook(() => useWorkspaceName());
    expect(result.current).toBe("Acme");
  });

  it("waits while the organization list loads", () => {
    mocks.session = session("org-1");
    const { result } = renderHook(() => useWorkspaceName());
    expect(result.current).toBeNull();
  });

  it("falls back to the generic name when the list fails", () => {
    mocks.session = session("org-1");
    mocks.organizations = { data: undefined, error: new Error("500") };
    const { result } = renderHook(() => useWorkspaceName());
    expect(result.current).toBe("workspace");
  });

  it("falls back to the generic name when the list lacks the organization", () => {
    mocks.session = session("org-1");
    mocks.organizations = {
      data: [{ id: "org-2", name: "Other" }],
      error: null,
    };
    const { result } = renderHook(() => useWorkspaceName());
    expect(result.current).toBe("workspace");
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
        "max-sm:[&_[data-testid=header-workspace-chrome]_.max-w-24]:sr-only",
      );
    },
  );

  it("leaves the trailing chrome alone for current", () => {
    mocks.variant = "current";
    const { container } = renderTrailing();

    expect(screen.getByTestId("trailing-child").parentElement).toBe(container);
  });
});

describe("HeaderBreadcrumbScope", () => {
  const HeaderBreadcrumbScope = headerSlots["header-center"];
  if (!HeaderBreadcrumbScope) throw new Error("No header-center slot");

  beforeEach(() => {
    // sm and up, where the workspace crumb shows.
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
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
  });

  it("links the workspace crumb out of a project", () => {
    mocks.pathname = "/projects/p-1";
    mocks.projectId = "p-1";
    render(<HeaderBreadcrumbScope />);

    expect(screen.getByRole("link", { name: "Acme" })).toHaveAttribute(
      "href",
      "/projects",
    );
  });

  it("keeps the workspace crumb as text in the workspace view", () => {
    mocks.pathname = "/tasks";
    render(<HeaderBreadcrumbScope />);

    expect(screen.getByText("Acme").tagName).toBe("SPAN");
    expect(screen.queryByRole("link")).toBeNull();
  });
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
