import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface SessionState {
  data: {
    user: { id?: string; name: string; email: string };
    session: { activeOrganizationId: string | null };
  } | null;
  error: Error | null;
}

interface OrganizationsState {
  data: { id: string; name: string }[] | undefined;
  error: Error | null;
}

const mocks = vi.hoisted(() => ({
  session: { data: null, error: null } as SessionState,
  organizations: { data: undefined, error: null } as OrganizationsState,
  load: vi.fn(),
  switchWorkspace: vi.fn(),
  isSwitching: false,
  startCreate: vi.fn(),
  createFor: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/tasks",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => mocks.session,
  authClient: { useListOrganizations: () => mocks.organizations },
}));
vi.mock("./variant-combined-actions", () => ({
  loadCombinedWorkspaces: mocks.load,
}));
vi.mock("@/app/components/header/header-workspace-avatar", () => ({
  default: () => <span aria-hidden />,
}));
vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({
    isPending: mocks.isSwitching,
    handleSelectWorkspace: mocks.switchWorkspace,
  }),
}));
vi.mock("@/app/components/header/use-create-workspace", () => ({
  useCreateWorkspace: (onSelect: unknown) => {
    mocks.createFor(onSelect);
    return {
      start: mocks.startCreate,
      dialogs: <p>create dialogs</p>,
      isCreatingPersonal: false,
    };
  },
}));

import { useWorkspaceName, WorkspaceCrumb } from "./variant-header-workspace";

function signInToAcme() {
  mocks.session = {
    data: {
      user: { id: "user-1", name: "Ada", email: "ada@example.com" },
      session: { activeOrganizationId: "org-1" },
    },
    error: null,
  };
  mocks.organizations = {
    data: [{ id: "org-1", name: "Acme" }],
    error: null,
  };
}

function renderCrumb() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceCrumb />
    </QueryClientProvider>,
  );
}

function crumb() {
  return screen.getByRole("button", { name: "switchWorkspace Acme" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { data: null, error: null };
  mocks.organizations = { data: undefined, error: null };
  mocks.isSwitching = false;
  mocks.switchWorkspace.mockResolvedValue(undefined);
  mocks.load.mockResolvedValue({
    members: [
      { organization: { id: "org-1", name: "Acme" } },
      { organization: { id: "org-2", name: "Globex" } },
    ],
    hasPersonalWorkspace: false,
  });
});

describe("WorkspaceCrumb", () => {
  it("holds a skeleton, not a switch, while the name loads", () => {
    renderCrumb();

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lists the workspaces only once opened", async () => {
    signInToAcme();
    renderCrumb();
    expect(mocks.load).not.toHaveBeenCalled();

    await userEvent.setup().click(crumb());

    expect(crumb()).toHaveAttribute("aria-expanded", "true");
    expect(
      await screen.findByRole("button", { name: "Globex" }),
    ).toBeInTheDocument();
    expect(mocks.load).toHaveBeenCalledOnce();
  });

  it("switches workspace and closes once the switch settles", async () => {
    signInToAcme();
    let finish = () => {};
    mocks.switchWorkspace.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    renderCrumb();

    await user.click(crumb());
    await user.click(await screen.findByRole("button", { name: "Globex" }));
    expect(mocks.switchWorkspace).toHaveBeenCalledExactlyOnceWith("org-2");
    expect(crumb()).toHaveAttribute("aria-expanded", "true");

    await act(async () => finish());
    await waitFor(() =>
      expect(crumb()).toHaveAttribute("aria-expanded", "false"),
    );
  });

  it.each([
    [false, true],
    [true, false],
  ])(
    "closes and starts Create workspace (personal workspace %s: can make one %s)",
    async (hasPersonalWorkspace, canCreatePersonal) => {
      signInToAcme();
      mocks.load.mockResolvedValue({ members: [], hasPersonalWorkspace });
      const user = userEvent.setup();
      renderCrumb();

      await user.click(crumb());
      await user.click(
        await screen.findByRole("button", { name: "createWorkspace" }),
      );

      expect(mocks.startCreate).toHaveBeenCalledExactlyOnceWith(
        canCreatePersonal,
      );
      expect(crumb()).toHaveAttribute("aria-expanded", "false");
    },
  );

  it("creates through the crumb's own switch and keeps the dialogs mounted", () => {
    signInToAcme();
    renderCrumb();

    expect(mocks.createFor).toHaveBeenLastCalledWith(mocks.switchWorkspace);
    // Outside the popover: they stay after it closes.
    expect(screen.getByText("create dialogs")).toBeInTheDocument();
  });

  it("marks itself busy while a switch runs", () => {
    signInToAcme();
    mocks.isSwitching = true;
    renderCrumb();

    expect(crumb()).toHaveAttribute("aria-busy", "true");
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
