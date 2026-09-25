import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/tasks",
  search: "projectId=p-1",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/link", () => ({
  default: ({
    prefetch: _prefetch,
    ...props
  }: ComponentProps<"a"> & { prefetch?: boolean }) => <a {...props} />,
}));
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
  loadMoreProjects: vi.fn(),
  loadPinnedProjects: vi.fn(),
}));
vi.mock("@/app/projects/components/inline-create-project-modal", () => ({
  InlineCreateProjectModal: () => null,
}));
// Like the real avatar: the fallback initial is text a link would read out.
vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: ({ name }: { name: string }) => (
    <span>{name.trim().charAt(0).toUpperCase()}</span>
  ),
}));

import { ProjectScopeMarker } from "../project-scope-marker";
import { hubSlots } from "./variant-hub";

const PLACES = ["header-center", "header-mobile"] as const;

function renderSlot(place: (typeof PLACES)[number], container?: HTMLElement) {
  const Slot = hubSlots[place];
  if (!Slot) throw new Error(`No hub slot ${place}`);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // A fresh element each time, or React skips the rerender.
  const view = () => (
    <QueryClientProvider client={client}>
      <Slot />
    </QueryClientProvider>
  );
  const result = render(view(), container ? { container } : undefined);
  return { ...result, rerender: () => result.rerender(view()) };
}

/** The slot inside the app header, after a control that stays put. */
function renderInHeader(place: (typeof PLACES)[number]) {
  const home = document.createElement("a");
  home.href = "/";
  home.textContent = "home";
  const header = document.createElement("header");
  header.append(home);
  document.body.append(header);
  const result = renderSlot(
    place,
    header.appendChild(document.createElement("div")),
  );
  return { ...result, home };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/tasks";
  mocks.search = "projectId=p-1";
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        Response.json({ project: { id: "p-1", name: "Acme", logo: null } }),
      ),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe.each(PLACES)("hub %s", (place) => {
  it("names the scoped project on a scoped workspace page", async () => {
    renderSlot(place);

    // The whole name: the avatar's initial "A" stays out of it.
    const link = await screen.findByRole("link", { name: "label: Acme" });
    expect(link.getAttribute("href")).toBe("/projects/p-1");
  });

  it("names the project a task detail page reports", async () => {
    mocks.pathname = "/tasks/t-1";
    mocks.search = "";
    render(<ProjectScopeMarker projectId="p-1" />);
    renderSlot(place);

    const link = await screen.findByRole("link", { name: "label: Acme" });
    expect(link.getAttribute("href")).toBe("/projects/p-1");
  });

  it("names the project once, as Project, while it has no name", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(Response.json({ project: null })),
    );
    renderSlot(place);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(await screen.findByRole("link", { name: "label" })).toHaveAttribute(
      "href",
      "/projects/p-1",
    );
  });

  it("moves focus into the header once a clear lands", async () => {
    const user = userEvent.setup();
    const { rerender, home } = renderInHeader(place);

    await user.click(screen.getByRole("button", { name: "workspaceView" }));
    // Still scoped until the navigation commits.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "workspaceView" }),
    );

    mocks.search = "";
    rerender();

    expect(screen.queryByRole("button", { name: "workspaceView" })).toBeNull();
    expect(document.activeElement).toBe(home);
  });

  it("leaves focus alone on a later scope end, after a clear landed", async () => {
    const user = userEvent.setup();
    const { rerender, home } = renderInHeader(place);
    await user.click(screen.getByRole("button", { name: "workspaceView" }));
    mocks.search = "";
    rerender();
    expect(document.activeElement).toBe(home);
    home.blur();

    // Back to the scoped page, then the same unscoped page by another link.
    mocks.search = "projectId=p-1";
    rerender();
    mocks.search = "";
    rerender();

    expect(document.activeElement).toBe(document.body);
  });

  it("leaves focus alone when another link lands before the clear", async () => {
    const user = userEvent.setup();
    const { rerender } = renderInHeader(place);
    await user.click(screen.getByRole("button", { name: "workspaceView" }));

    // The reader followed Chat before /tasks committed.
    mocks.pathname = "/chat";
    rerender();
    expect(document.activeElement).toBe(document.body);

    // The clear's own page, once Chat settled it, moves nothing either.
    mocks.pathname = "/tasks";
    mocks.search = "";
    rerender();
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves focus alone when the scope ends without a clear", () => {
    const { rerender } = renderInHeader(place);

    mocks.search = "";
    rerender();

    expect(document.activeElement).toBe(document.body);
  });

  it("clears the scope in place", async () => {
    const user = userEvent.setup();
    renderSlot(place);

    await user.click(screen.getByRole("button", { name: "workspaceView" }));

    // select(null) on /tasks: the workspace version of the same page.
    expect(mocks.push).toHaveBeenCalledWith("/tasks");
  });

  it.each([
    ["a project page", "/projects/p-1", ""],
    ["an unscoped workspace page", "/tasks", ""],
    ["a page with no project version", "/chat", "projectId=p-1"],
  ])("renders nothing on %s", (_case, pathname, search) => {
    mocks.pathname = pathname;
    mocks.search = search;
    const { container } = renderSlot(place);

    expect(container).toBeEmptyDOMElement();
  });
});
