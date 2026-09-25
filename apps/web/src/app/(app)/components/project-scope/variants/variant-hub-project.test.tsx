import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/projects/p-1",
  push: vi.fn(),
  isMobile: false,
  load: vi.fn(),
  loadPinned: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(),
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
  loadMoreProjects: mocks.load,
  loadPinnedProjects: mocks.loadPinned,
}));
vi.mock("@/app/projects/components/inline-create-project-modal", () => ({
  InlineCreateProjectModal: ({ open }: { open: boolean }) => (
    <div data-testid="create-project-modal" data-open={String(open)} />
  ),
}));
vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: () => <span aria-hidden />,
}));

import { HubProjectHeader } from "./variant-hub-project";

function renderHeader(calendarBeta?: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <HubProjectHeader calendarBeta={calendarBeta} />
    </QueryClientProvider>,
  );
  return within(screen.getByRole("navigation", { name: "sections" }));
}

function sectionLinks(nav: ReturnType<typeof renderHeader>) {
  return nav
    .getAllByRole("link")
    .map((link) => [link.textContent, link.getAttribute("href")]);
}

function project(id: string, name: string) {
  return { id, name, logo: null, closedAt: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/projects/p-1";
  mocks.isMobile = false;
  mocks.loadPinned.mockResolvedValue([]);
  mocks.load.mockResolvedValue({
    projects: [project("p-1", "Acme"), project("p-2", "Beta")],
    nextCursor: null,
  });
  // The menu's read of the selected project.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json({ project: null }))),
  );
  // happy-dom lays nothing out; the nav only has to ask.
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HubProjectHeader", () => {
  it("lists every section, Calendar and Social included, with Calendar beta", () => {
    const nav = renderHeader(true);

    expect(sectionLinks(nav)).toEqual([
      ["overview", "/projects/p-1"],
      ["tasks", "/tasks?projectId=p-1"],
      ["schedules", "/schedules?projectId=p-1"],
      // The project page, where the hub nav lives, not /calendar?projectId=.
      ["calendar", "/projects/p-1/calendar"],
      ["files", "/drive?view=tasks&projectId=p-1"],
      ["history", "/history?projectId=p-1"],
      ["social", "/projects/p-1/social"],
    ]);
  });

  it("drops Calendar and Social without Calendar beta", () => {
    const nav = renderHeader();

    expect(sectionLinks(nav).map(([name]) => name)).toEqual([
      "overview",
      "tasks",
      "schedules",
      "files",
      "history",
    ]);
  });

  it("marks only the section of the current page", () => {
    mocks.pathname = "/projects/p-1/calendar";
    const nav = renderHeader(true);

    const current = nav
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual(["calendar"]);
  });

  it("renders nothing off a project page", () => {
    mocks.pathname = "/tasks";
    const client = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={client}>
        <HubProjectHeader calendarBeta />
      </QueryClientProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("scrolls the current section into view, again on navigation", () => {
    mocks.pathname = "/projects/p-1/social";
    const client = new QueryClient();
    // A fresh element each time, or React skips the rerender.
    const view = () => (
      <QueryClientProvider client={client}>
        <HubProjectHeader calendarBeta />
      </QueryClientProvider>
    );
    const { rerender } = render(view());
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(
      screen.getByRole("link", { name: "social" }),
    );
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });

    mocks.pathname = "/projects/p-1/calendar";
    rerender(view());

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView.mock.contexts[1]).toBe(
      screen.getByRole("link", { name: "calendar" }),
    );
  });
});

describe("HubProjectSwitcher", () => {
  it.each([
    ["a popover on desktop", false],
    ["a sheet on mobile", true],
  ])(
    "opens the menu in %s and closes it on a pick",
    async (_case, isMobile) => {
      mocks.isMobile = isMobile;
      const user = userEvent.setup();
      renderHeader();

      const trigger = screen.getByRole("button", { name: "switchLabel" });
      await user.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");

      await user.click(await screen.findByText("Beta"));

      expect(mocks.push).toHaveBeenCalledWith("/projects/p-2");
      await waitFor(() =>
        expect(screen.queryByPlaceholderText("searchPlaceholder")).toBeNull(),
      );
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    },
  );

  it("keeps the section when it switches project", async () => {
    mocks.pathname = "/projects/p-1/calendar";
    const user = userEvent.setup();
    renderHeader(true);

    await user.click(screen.getByRole("button", { name: "switchLabel" }));
    await user.click(await screen.findByText("Beta"));

    expect(mocks.push).toHaveBeenCalledWith("/projects/p-2/calendar");
  });

  it("renders the create dialog and opens it from the menu", async () => {
    const user = userEvent.setup();
    renderHeader();

    const dialog = screen.getByTestId("create-project-modal");
    expect(dialog).toHaveAttribute("data-open", "false");

    await user.click(screen.getByRole("button", { name: "switchLabel" }));
    await user.click(await screen.findByTestId("project-scope-create"));

    expect(dialog).toHaveAttribute("data-open", "true");
  });
});
