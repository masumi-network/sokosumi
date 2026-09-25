import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InlineCreateProjectModal } from "@/app/projects/components/inline-create-project-modal";
import { SidebarProvider } from "@/components/ui/sidebar";

type CreateModalProps = ComponentProps<typeof InlineCreateProjectModal>;

const mocks = vi.hoisted(() => ({
  pathname: "/tasks",
  search: "",
  isMobile: false,
  push: vi.fn(),
  fetch: vi.fn(),
  modal: { current: null as CreateModalProps | null },
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
// The wizard pulls in the whole Create flow. The stub keeps the props, so a
// test can finish or cancel Create the way the real dialog does.
vi.mock("@/app/projects/components/inline-create-project-modal", () => ({
  InlineCreateProjectModal: (props: CreateModalProps) => {
    mocks.modal.current = props;
    return props.open ? (
      <div role="dialog" aria-label="create-project" />
    ) : null;
  },
}));
vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: () => <span aria-hidden />,
}));

import { sidebarSlots } from "./variant-sidebar";
import {
  openScopeCreate,
  openScopeSheet,
  SidebarScopeMobileChip,
} from "./variant-sidebar-mobile";

const SidebarTop = sidebarSlots["sidebar-top"];

function Harness({ chip = true }: { chip?: boolean }) {
  if (!SidebarTop) throw new Error("Missing sidebar slot");
  return (
    <SidebarProvider>
      <header>
        <button type="button">header-home</button>
      </header>
      <SidebarTop />
      {chip ? <SidebarScopeMobileChip /> : null}
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

function modal() {
  if (!mocks.modal.current) throw new Error("Create dialog never rendered");
  return mocks.modal.current;
}

/** The close event Radix hands to onCloseAutoFocus. */
function closeEvent() {
  return new Event("focusout", { cancelable: true });
}

/** Cancels Create project: the dialog closes, then asks where focus goes. */
function cancelCreate() {
  const event = closeEvent();
  act(() => modal().onOpenChange(false));
  (document.activeElement as HTMLElement | null)?.blur();
  act(() => modal().onCloseAutoFocus?.(event));
  return event;
}

async function openCreateFrom(trigger: HTMLElement) {
  const user = userEvent.setup();
  await user.click(trigger);
  await user.click(await screen.findByTestId("project-scope-create"));
  await screen.findByRole("dialog", { name: "create-project" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/tasks";
  mocks.search = "";
  mocks.isMobile = false;
  mocks.modal.current = null;
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

describe("sidebar variant store", () => {
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

  it("closes both the sheet and Create when the chip unmounts", async () => {
    mocks.isMobile = true;
    const view = renderHarness();
    act(() => {
      openScopeSheet();
      openScopeCreate();
    });
    expect(
      await screen.findByRole("dialog", { name: "switchLabel" }),
    ).toBeInTheDocument();
    expect(row()).toHaveAttribute("aria-expanded", "true");
    // The open sheet hides the rest of the page from role queries.
    expect(modal().open).toBe(true);

    view.setChip(false);

    // The row reads the store with no chip mounted.
    expect(row()).toHaveAttribute("aria-expanded", "false");

    view.setChip(true);

    expect(
      screen.queryByRole("dialog", { name: "switchLabel" }),
    ).not.toBeInTheDocument();
    expect(modal().open).toBe(false);
  });
});

describe("sidebar variant scope name", () => {
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
});

describe("sidebar variant chip", () => {
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

  it("sends focus to a visible header control when the hidden chip's sheet closes", async () => {
    const user = userEvent.setup();
    mocks.isMobile = true;
    mocks.pathname = "/chat/rooms/r-1";
    renderHarness();
    // happy-dom gives every element one rect; a `display: none` chip has none.
    vi.spyOn(chip(), "getClientRects").mockReturnValue({
      length: 0,
    } as DOMRectList);

    await user.click(row());
    await screen.findByRole("dialog", { name: "switchLabel" });
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "switchLabel" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "header-home" }),
      ),
    );
  });
});

describe("sidebar variant Create project", () => {
  it("switches to the project that Create made", async () => {
    renderHarness();
    await openCreateFrom(row());
    // Analytics tell switcher creates apart from the task form's.
    expect(modal().creationSource).toBe("project_switcher");

    act(() => modal().onCreated({ projectId: "p-new", name: "New" }));

    expect(mocks.push).toHaveBeenCalledWith("/tasks?projectId=p-new");
  });

  it("returns focus to the sidebar row on cancel", async () => {
    renderHarness();
    await openCreateFrom(row());

    const event = cancelCreate();

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(row());
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("returns focus to the chip on cancel", async () => {
    mocks.isMobile = true;
    renderHarness();
    await openCreateFrom(chip());

    const event = cancelCreate();

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(chip());
  });

  it("sends focus to the header when the opener is hidden", async () => {
    mocks.isMobile = true;
    mocks.pathname = "/chat/rooms/r-1";
    renderHarness();
    vi.spyOn(chip(), "getClientRects").mockReturnValue({
      length: 0,
    } as DOMRectList);
    // The row hands off to the hidden chip's sheet, so the chip is the opener.
    await openCreateFrom(row());

    const event = cancelCreate();

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "header-home" }),
    );
  });
});
