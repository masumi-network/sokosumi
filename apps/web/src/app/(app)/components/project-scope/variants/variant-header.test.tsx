import { render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
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
  useProjectScopeSwitch: () => ({}),
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

  it.each<ScopeVariantId>(["header", "command", "combined", "sidebar"])(
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

  it.each<ScopeVariantId>(["hub", "current"])(
    "leaves the trailing chrome alone for %s",
    (variant) => {
      mocks.variant = variant;
      const { container } = renderTrailing();

      expect(screen.getByTestId("trailing-child").parentElement).toBe(
        container,
      );
    },
  );
});
