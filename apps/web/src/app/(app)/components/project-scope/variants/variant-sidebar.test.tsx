import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";

const mocks = vi.hoisted(() => ({
  pathname: "/tasks",
  search: "",
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
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
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

function Harness({ chip = true }: { chip?: boolean }) {
  if (!SidebarTop || !HeaderMobile) throw new Error("Missing sidebar slots");
  return (
    <SidebarProvider>
      <SidebarTop />
      {chip ? <HeaderMobile /> : null}
    </SidebarProvider>
  );
}

function renderHarness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return {
    ...view,
    setChip(chip: boolean) {
      view.rerender(
        <QueryClientProvider client={client}>
          <Harness chip={chip} />
        </QueryClientProvider>,
      );
    },
  };
}

function row() {
  return screen.getByTestId("project-scope-sidebar-row");
}

function chip() {
  return screen.getByTestId("project-scope-sidebar-chip");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/tasks";
  mocks.search = "";
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

  it("resets the store when the chip unmounts", async () => {
    const user = userEvent.setup();
    const view = renderHarness();
    await user.click(row());
    await user.click(await screen.findByTestId("project-scope-create"));
    await screen.findByRole("dialog", { name: "create-project" });

    view.setChip(false);
    view.setChip(true);

    expect(
      screen.queryByRole("dialog", { name: "create-project" }),
    ).not.toBeInTheDocument();
  });

  it("names the workspace view when no project is scoped", () => {
    renderHarness();

    expect(row()).toHaveAccessibleName("label: workspaceView");
    expect(chip()).toHaveAccessibleName("label: workspaceView");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('reads "Project" while the project loads, then its name', async () => {
    let answer: (response: Response) => void = () => {};
    mocks.fetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
    );
    mocks.search = "projectId=p-1";
    renderHarness();

    expect(row()).toHaveAccessibleName("label: label");
    expect(chip()).toHaveAccessibleName("label: label");

    answer(Response.json({ project: { id: "p-1", name: "Acme", logo: null } }));
    await waitFor(() => expect(row()).toHaveAccessibleName("label: Acme"));
    expect(chip()).toHaveAccessibleName("label: Acme");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/project-scope/p-1",
      expect.anything(),
    );
  });

  it("hides the chip on a chat room but keeps its dialog reachable", async () => {
    const user = userEvent.setup();
    mocks.pathname = "/chat/rooms/r-1";
    renderHarness();

    expect(chip().closest(".hidden")).not.toBeNull();

    await user.click(row());
    await user.click(await screen.findByTestId("project-scope-create"));
    expect(
      await screen.findByRole("dialog", { name: "create-project" }),
    ).toBeInTheDocument();
  });
});
