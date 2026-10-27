import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("@/lib/project-scope-list.client", () => ({
  fetchScopeList: (path: string) =>
    path.startsWith("/api/project-scope/pinned")
      ? mocks.loadPinned()
      : Promise.resolve({ projects: [], nextCursor: null }),
}));
// The wizard pulls in the whole Create flow; only "it opened" matters here.
vi.mock("@/app/projects/components/inline-create-project-modal", () => ({
  InlineCreateProjectModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="create-project" /> : null,
}));
vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: () => <span aria-hidden />,
}));

import { SidebarProjectScope as SidebarTop } from "./sidebar-project-scope";
import { SidebarScopeMobileChip as HeaderMobile } from "./sidebar-project-scope-mobile";

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

function Harness() {
  return (
    <SidebarProvider>
      <header>
        <button type="button">header-home</button>
      </header>
      <MobileSidebarProbe />
      <SidebarTop />
      <HeaderMobile />
    </SidebarProvider>
  );
}

function renderHarness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

function title() {
  return screen.getByTestId("project-scope-sidebar-title");
}

/**
 * The scope's name alone, with no "Project" line over it, and the chevron
 * after it. The accessible name still says what it is.
 */
function expectTitled(value: string) {
  expect(title()).toHaveTextContent(new RegExp(`^${value}$`));
  const name = within(title()).getByText(value, { exact: true });
  const chevron = title().querySelector("svg");
  if (!chevron) throw new Error("no chevron");
  expect(
    name.compareDocumentPosition(chevron) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
}

function tokens(element: Element): string[] {
  return (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
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

describe("sidebar project scope", () => {
  it("opens the chip's Create dialog from the desktop popover", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(title());
    await user.click(await screen.findByTestId("project-scope-create"));

    expect(
      await screen.findByRole("dialog", { name: "create-project" }),
    ).toBeInTheDocument();
  });

  it("hands the mobile title off to the chip's bottom sheet", async () => {
    const user = userEvent.setup();
    mocks.isMobile = true;
    renderHarness();

    await user.click(title());

    expect(
      await screen.findByRole("dialog", { name: "switchLabel" }),
    ).toBeInTheDocument();
    expect(title()).toHaveAttribute("aria-expanded", "true");
  });

  it("closes the mobile sidebar when the title hands off", async () => {
    const user = userEvent.setup();
    mocks.isMobile = true;
    renderHarness();
    await user.click(probe());
    expect(probe()).toHaveAttribute("data-open", "true");

    await user.click(title());

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

    await user.click(title());
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

  it("titles the nav All projects when no project is picked", () => {
    renderHarness();

    expectTitled("allProjects");
    expect(title()).toHaveAccessibleName("label: allProjects");
  });

  it("titles the nav with the picked project's name", async () => {
    mocks.search = "projectId=p-1";
    renderHarness();

    await waitFor(() => expect(title()).toHaveAccessibleName("label: Acme"));
    expectTitled("Acme");
  });

  // The title the nav sits under, not one more row of it: no leading mark,
  // a semibold name shortened with "…" that stays whole in its name.
  it("is a title rather than a sidebar row", () => {
    const { container } = renderHarness();
    const name = within(title()).getByText("allProjects", { exact: true });

    expect(title()).not.toHaveAttribute("data-sidebar", "menu-button");
    expect(
      container.querySelector(
        '[data-testid="project-scope-sidebar-title"] [data-slot="sidebar-row-slot"]',
      ),
    ).toBeNull();
    expect(tokens(title())).toContain("font-semibold");
    expect(tokens(name)).toEqual(
      expect.arrayContaining(["min-w-0", "truncate"]),
    );
  });

  // A thumb's 44px on the phone sheet, the sketch's 32px with a pointer.
  it("keeps a touch-sized target on the phone sheet", () => {
    renderHarness();

    expect(tokens(title())).toEqual(expect.arrayContaining(["h-11", "md:h-8"]));
  });

  it("draws no rule under the picker", () => {
    const { container } = renderHarness();

    expect(container.querySelector('[data-sidebar="separator"]')).toBeNull();
  });

  it("names the mobile title with the full scope label", async () => {
    mocks.isMobile = true;
    mocks.search = "projectId=p-1";
    renderHarness();

    await waitFor(() => expect(title()).toHaveAccessibleName("label: Acme"));
  });
});
