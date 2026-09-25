import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceSwitcher } from "./variant-combined-parts";

const mocks = vi.hoisted(() => ({
  isSwitching: { current: false },
  hasPersonalWorkspace: { current: false },
  workspaceName: { current: "Acme" as string | null },
  activate: vi.fn(),
  startCreate: vi.fn(),
  createFor: vi.fn(),
  scopedFor: vi.fn(),
  scopedSwitch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
// The real `useWorkspaceSwitcher` runs; only the activation call is faked.
vi.mock("@/lib/activate-organization-workspace", () => ({
  activateOrganizationWorkspace: mocks.activate,
  isUserNotMemberOfOrganizationError: () => false,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("./variant-header-workspace", () => ({
  useWorkspaceName: () => mocks.workspaceName.current,
}));
vi.mock("@/app/components/header/use-create-workspace", () => ({
  useCreateWorkspace: (onSelect: unknown) => {
    mocks.createFor(onSelect);
    return {
      start: mocks.startCreate,
      dialogs: <p data-testid="create-dialogs" />,
      isCreatingPersonal: false,
    };
  },
}));
vi.mock("@/lib/auth/auth.client", () => ({ useSession: vi.fn() }));
vi.mock("./variant-combined-actions", () => ({
  loadCombinedWorkspaces: vi.fn(),
}));
vi.mock("@/app/projects/actions", () => ({
  loadMoreProjects: vi.fn(),
  loadPinnedProjects: vi.fn(),
}));
vi.mock("@/app/projects/components/inline-create-project-modal", () => ({
  InlineCreateProjectModal: () => null,
}));
vi.mock("@/app/components/header/header-workspace-avatar", () => ({
  default: () => null,
}));
vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: () => null,
}));
// The panes are real. The workspaces read Core, so a fixed list stands in,
// but its switch goes through the `switcher` the trigger passes down.
vi.mock("./variant-combined-parts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./variant-combined-parts")>()),
  useScopedWorkspaceSwitch: (switcher: WorkspaceSwitcher) => {
    mocks.scopedFor(switcher);
    return mocks.scopedSwitch;
  },
  useCombinedScope: () => ({
    projectId: null,
    name: "All projects",
    mark: null,
    select: vi.fn(),
    openCreate: vi.fn(),
    createDialog: null,
  }),
  useCombinedWorkspaces: (switcher: WorkspaceSwitcher) => ({
    sessionUser: null,
    rows: [
      { id: "org-1", name: "Acme", organization: null },
      { id: "org-2", name: "Globex", organization: null },
    ],
    activeId: "org-1",
    active: { id: "org-1", name: "Acme", organization: null },
    isPending: false,
    isError: false,
    hasPersonalWorkspace: mocks.hasPersonalWorkspace.current,
    refetch: vi.fn(),
    isSwitching: mocks.isSwitching.current || switcher.isPending,
    select: (id: string | null) => switcher.handleSelectWorkspace(id),
  }),
}));
vi.mock("@/app/components/project-scope/project-scope-menu", () => ({
  ProjectScopeMenu: () => <p>project menu</p>,
}));

import { combinedSlots } from "./variant-combined";

function slot(name: keyof typeof combinedSlots) {
  const Slot = combinedSlots[name];
  if (!Slot) throw new Error(`The combined variant has no ${name} slot.`);
  return Slot;
}

const HeaderTrigger = slot("header-workspace");

function trigger() {
  return screen.getByTestId("project-scope-combined-header-trigger");
}

function workspaceList() {
  return screen.getByRole("list", { name: "switchWorkspace" });
}

function projectPane() {
  return screen.getByTestId("project-scope-combined-project-pane");
}

beforeEach(() => {
  mocks.activate.mockResolvedValue(undefined);
});

afterEach(() => {
  mocks.isSwitching.current = false;
  mocks.hasPersonalWorkspace.current = false;
  mocks.workspaceName.current = "Acme";
  vi.clearAllMocks();
});

describe("HeaderTrigger", () => {
  it("names the workspace and the project, and opens both panes", async () => {
    const user = userEvent.setup();
    render(<HeaderTrigger />);

    expect(trigger()).toHaveAccessibleName("switchLabel Acme / All projects");
    await user.click(trigger());

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(workspaceList()).toBeInTheDocument();
    expect(screen.getByText("project menu")).toBeInTheDocument();
    expect(projectPane()).not.toHaveAttribute("inert");
  });

  it("names only the project while the workspace name loads", () => {
    mocks.workspaceName.current = null;
    render(<HeaderTrigger />);

    expect(trigger()).toHaveAccessibleName("switchLabel All projects");
  });

  it("shows from md up; the chip and today's switch cover smaller screens", () => {
    render(<HeaderTrigger />);

    expect(trigger().parentElement).toHaveClass("max-md:hidden");
    // Dialogs stay outside the hidden box.
    expect(
      screen.getByTestId("create-dialogs").closest(".max-md\\:hidden"),
    ).toBeNull();
  });

  it("shuts the project pane while a workspace switch runs", async () => {
    mocks.isSwitching.current = true;
    const user = userEvent.setup();
    render(<HeaderTrigger />);

    await user.click(trigger());

    expect(
      await screen.findByTestId("project-scope-combined-project-pane"),
    ).toHaveAttribute("inert");
  });

  it("stays busy when the popover closes and reopens mid-switch", async () => {
    let finish = () => {};
    mocks.activate.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<HeaderTrigger />);

    await user.click(trigger());
    await user.click(await screen.findByRole("button", { name: "Globex" }));
    expect(trigger()).toHaveAttribute("aria-busy", "true");
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(trigger());

    // The old workspace's projects would 404 once the switch lands.
    const pane = await screen.findByTestId(
      "project-scope-combined-project-pane",
    );
    expect(pane).toHaveAttribute("inert");
    expect(pane).toHaveAttribute("aria-busy", "true");
    for (const name of ["Acme", "Globex"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
    await user.click(screen.getByRole("button", { name: "Globex" }));
    expect(mocks.activate).toHaveBeenCalledExactlyOnceWith("org-2");

    await act(async () => finish());
    await waitFor(() => expect(pane).not.toHaveAttribute("inert"));
    expect(trigger()).not.toHaveAttribute("aria-busy");
  });

  it.each([
    [false, true],
    [true, false],
  ])(
    "closes and starts Create workspace (personal workspace %s: can make one %s)",
    async (hasPersonalWorkspace, canCreatePersonal) => {
      mocks.hasPersonalWorkspace.current = hasPersonalWorkspace;
      const user = userEvent.setup();
      render(<HeaderTrigger />);

      await user.click(trigger());
      await user.click(
        await screen.findByRole("button", { name: "createWorkspace" }),
      );

      expect(mocks.startCreate).toHaveBeenCalledExactlyOnceWith(
        canCreatePersonal,
      );
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
    },
  );

  it("activates a created workspace like a picked one, through its own switch", async () => {
    render(<HeaderTrigger />);

    // The scoped switch drops the project; the raw one would leave a 404.
    expect(mocks.createFor).toHaveBeenLastCalledWith(mocks.scopedSwitch);
    const switcher = mocks.scopedFor.mock.lastCall?.[0] as WorkspaceSwitcher;
    await act(() => switcher.handleSelectWorkspace("org-2"));
    expect(mocks.activate).toHaveBeenCalledExactlyOnceWith("org-2");
  });
});
