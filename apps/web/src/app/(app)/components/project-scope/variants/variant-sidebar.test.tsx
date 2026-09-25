import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";

const mocks = vi.hoisted(() => ({
  pathname: "/tasks",
  search: "",
  isMobile: false,
  push: vi.fn(),
  fetch: vi.fn(),
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
  loadPinnedProjects: vi.fn(() => Promise.resolve([])),
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

function Harness() {
  if (!SidebarTop || !HeaderMobile) throw new Error("Missing sidebar slots");
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
});
