import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";

const mocks = vi.hoisted(() => ({
  pathname: "/tasks",
  search: "",
  isMobile: false,
  push: vi.fn(),
  fetch: vi.fn(),
  loadPinned: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mocks.isMobile }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    },
    isPending: false,
    error: null,
  }),
}));
vi.mock("@/app/projects/actions", () => ({
  loadMoreProjects: vi.fn(() =>
    Promise.resolve({ projects: [], nextCursor: null }),
  ),
  loadPinnedProjects: mocks.loadPinned,
}));
// The wizard pulls in the whole Create flow; only "it opened" matters here.
vi.mock("@/app/projects/components/inline-create-project-modal", () => ({
  InlineCreateProjectModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="create-project" /> : null,
}));
vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: () => <span aria-hidden />,
}));

import { sidebarSlots } from "./variant-sidebar";

const SidebarTop = sidebarSlots["sidebar-top"];
const HeaderMobile = sidebarSlots["header-mobile"];

/** Shows the mobile sidebar's open state, and opens it as its trigger would. */
function MobileSidebarProbe() {
  const { openMobile, setOpenMobile } = useSidebar();
  return (
    <button
      type="button"
      data-testid="mobile-sidebar-probe"
      data-open={openMobile}
      onClick={() => setOpenMobile(true)}
    >
      open-sidebar
    </button>
  );
}

interface HarnessOptions {
  /** Controls the desktop sidebar; `false` is the collapsed rail. */
  sidebarOpen?: boolean;
}

function Harness({ sidebarOpen }: HarnessOptions) {
  if (!SidebarTop || !HeaderMobile) throw new Error("Missing sidebar slots");
  return (
    <SidebarProvider open={sidebarOpen}>
      <header>
        <button type="button">header-home</button>
      </header>
      <MobileSidebarProbe />
      <SidebarTop />
      <HeaderMobile />
    </SidebarProvider>
  );
}

function renderHarness(options: HarnessOptions = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...options} />
    </QueryClientProvider>,
  );
}

function row() {
  return screen.getByTestId("project-scope-sidebar-row");
}

function probe() {
  return screen.getByTestId("mobile-sidebar-probe");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/tasks";
  mocks.search = "";
  mocks.isMobile = false;
  mocks.fetch.mockImplementation(() =>
    Promise.resolve(
      Response.json({ project: { id: "p-1", name: "Acme", logo: null } }),
    ),
  );
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.loadPinned.mockResolvedValue([]);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sidebar variant", () => {
  it("opens the chip's Create dialog from the desktop popover", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(row());
    await user.click(await screen.findByTestId("project-scope-create"));

    expect(
      await screen.findByRole("dialog", { name: "create-project" }),
    ).toBeInTheDocument();
  });

  it("hands the mobile row off to the chip's bottom sheet", async () => {
    const user = userEvent.setup();
    mocks.isMobile = true;
    renderHarness();

    await user.click(row());

    expect(
      await screen.findByRole("dialog", { name: "switchLabel" }),
    ).toBeInTheDocument();
    expect(row()).toHaveAttribute("aria-expanded", "true");
  });

  it("closes the mobile sidebar when the row hands off", async () => {
    const user = userEvent.setup();
    mocks.isMobile = true;
    renderHarness();
    await user.click(probe());
    expect(probe()).toHaveAttribute("data-open", "true");

    await user.click(row());

    expect(probe()).toHaveAttribute("data-open", "false");
    expect(
      await screen.findByRole("dialog", { name: "switchLabel" }),
    ).toBeInTheDocument();
  });

  it("closes the desktop popover and navigates when a project is picked", async () => {
    const user = userEvent.setup();
    mocks.loadPinned.mockResolvedValue([
      { id: "p-2", name: "Beta", logo: null, closedAt: null },
    ]);
    renderHarness();

    await user.click(row());
    expect(
      await screen.findByRole("dialog", { name: "switchLabel" }),
    ).toBeInTheDocument();
    await user.click(await screen.findByTestId("project-scope-item-p-2"));

    expect(mocks.push).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "switchLabel" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("names the mobile row with the full scope label", async () => {
    mocks.isMobile = true;
    mocks.search = "projectId=p-1";
    renderHarness();

    await waitFor(() => expect(row()).toHaveAccessibleName("label: Acme"));
  });
});

describe("sidebar variant rail tooltip", () => {
  it("shows the scope label when the rail row is hovered", async () => {
    const user = userEvent.setup();
    renderHarness({ sidebarOpen: false });

    await user.hover(row());

    expect(
      await screen.findByRole("tooltip", { name: "label: workspaceView" }),
    ).toBeInTheDocument();
  });

  it("hides the tooltip while the sidebar is expanded", async () => {
    const user = userEvent.setup();
    renderHarness({ sidebarOpen: true });

    await user.hover(row());

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("hides the tooltip over the row's own open popover", async () => {
    const user = userEvent.setup();
    renderHarness({ sidebarOpen: false });

    await user.click(row());
    expect(
      await screen.findByRole("dialog", { name: "switchLabel" }),
    ).toBeInTheDocument();
    await user.unhover(row());
    await user.hover(row());

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
