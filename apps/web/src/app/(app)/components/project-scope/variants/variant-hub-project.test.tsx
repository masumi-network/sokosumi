import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/projects/p-1",
  search: "",
  push: vi.fn(),
  isMobile: false,
  load: vi.fn(),
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

import {
  HubProjectHeader,
  hasOverflowEnd,
  revealDelta,
} from "./variant-hub-project";

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
  mocks.search = "";
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
  // happy-dom lays nothing out: a 200px strip of 80px tabs, 100px apart.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return stripLayout(this);
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const STRIP_WIDTH = 200;
const TAB_PITCH = 100;
const TAB_WIDTH = 80;

function rect(left: number, width: number) {
  return DOMRect.fromRect({ x: left, y: 0, width, height: 0 });
}

function stripLayout(element: HTMLElement): DOMRect {
  const list = element.closest("ul");
  if (!list) return rect(0, 0);
  if (element === list) return rect(0, STRIP_WIDTH);
  const item = element.closest("li");
  const index = item ? Array.from(list.children).indexOf(item) : 0;
  return rect(index * TAB_PITCH - list.scrollLeft, TAB_WIDTH);
}

/** Renders the header and lets the test move to another page. */
function renderNav(calendarBeta = true) {
  const client = new QueryClient();
  // A fresh element each time, or React skips the rerender.
  const view = () => (
    <QueryClientProvider client={client}>
      <HubProjectHeader calendarBeta={calendarBeta} />
    </QueryClientProvider>
  );
  const { rerender } = render(view());
  const nav = screen.getByRole("navigation", { name: "sections" });
  const list = within(nav).getByRole("list");
  return {
    list,
    navigate: (pathname: string, search = "") => {
      mocks.pathname = pathname;
      mocks.search = search;
      rerender(view());
    },
  };
}

const FADE_WIDTH = 32;

/**
 * happy-dom applies no Tailwind: give the strip the end scroll padding its
 * classes set, the width of the fade.
 */
function stubStripFade() {
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
    element instanceof HTMLUListElement
      ? ({
          scrollPaddingInlineEnd: `${FADE_WIDTH}px`,
        } as CSSStyleDeclaration)
      : computed(element),
  );
}

/** Every scroll that would move something other than the strip. */
function spyOnPageScrolls() {
  return [
    vi.spyOn(window, "scrollTo"),
    vi.spyOn(window, "scrollBy"),
    vi.spyOn(window, "scroll"),
    vi.spyOn(Element.prototype, "scrollIntoView"),
  ];
}

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

  it("scrolls only the strip to the current section, again on navigation", () => {
    const pageScrolls = spyOnPageScrolls();
    mocks.pathname = "/projects/p-1/social";
    const { list, navigate } = renderNav();

    // Social, the seventh tab, ends at 680: its end meets the strip's.
    expect(list.scrollLeft).toBe(6 * TAB_PITCH + TAB_WIDTH - STRIP_WIDTH);

    navigate("/projects/p-1/calendar");

    // Calendar, the fourth, sits left of the view: its start meets the strip's.
    expect(list.scrollLeft).toBe(3 * TAB_PITCH);
    for (const spy of pageScrolls) expect(spy).not.toHaveBeenCalled();
  });

  it("keeps the current tab clear of the fade while more tabs follow", () => {
    stubStripFade();
    mocks.pathname = "/projects/p-1/calendar";
    const { list, navigate } = renderNav();

    // Calendar ends at 380, and the fade starts 32 before the strip's end.
    expect(list.scrollLeft).toBe(
      3 * TAB_PITCH + TAB_WIDTH - (STRIP_WIDTH - FADE_WIDTH),
    );

    navigate("/projects/p-1/social");

    // Social is the last tab: at the strip's end the fade is gone.
    expect(list.scrollLeft).toBe(6 * TAB_PITCH + TAB_WIDTH - STRIP_WIDTH);
  });

  it("brings a keyboard-focused tab out from under the fade", () => {
    stubStripFade();
    const { list } = renderNav();
    expect(list.scrollLeft).toBe(0);

    // Tasks, 100 to 180, is inside the strip but under the fade from 168.
    act(() => within(list).getByRole("link", { name: "tasks" }).focus());

    expect(list.scrollLeft).toBe(
      TAB_PITCH + TAB_WIDTH - (STRIP_WIDTH - FADE_WIDTH),
    );
  });

  it("leaves the page where it was when the Edit modal closes", () => {
    const pageScrolls = spyOnPageScrolls();
    const stripScroll = vi.spyOn(Element.prototype, "scrollTo");
    const { navigate } = renderNav();

    navigate("/projects/p-1/edit");
    navigate("/projects/p-1");

    // Overview is in view, so nothing scrolls, the page least of all.
    expect(stripScroll).not.toHaveBeenCalled();
    for (const spy of pageScrolls) expect(spy).not.toHaveBeenCalled();
  });

  it("leaves a strip the reader scrolled when only the search changes", () => {
    mocks.pathname = "/projects/p-1/social";
    const { list, navigate } = renderNav();
    list.scrollLeft = 0;

    navigate("/projects/p-1/social", "date=2026-09-25");

    expect(list.scrollLeft).toBe(0);
  });

  it("fades the strip's end only while more tabs sit past it", () => {
    // Fires only for the elements the component asked to watch.
    const observed = new Map<Element, () => void>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        callback: () => void;
        constructor(callback: () => void) {
          this.callback = callback;
        }
        observe(target: Element) {
          observed.set(target, this.callback);
        }
        disconnect() {
          observed.clear();
        }
      },
    );
    const resize = (target: Element) => observed.get(target)?.();
    const { list } = renderNav();
    Object.defineProperty(list, "scrollWidth", { value: 680 });
    Object.defineProperty(list, "clientWidth", {
      value: STRIP_WIDTH,
      configurable: true,
    });

    fireEvent.scroll(list);
    expect(list).toHaveAttribute("data-overflow-end");

    list.scrollLeft = 480;
    fireEvent.scroll(list);
    expect(list).not.toHaveAttribute("data-overflow-end");

    list.scrollLeft = 0;
    fireEvent.scroll(list);
    expect(list).toHaveAttribute("data-overflow-end");

    // The strip widens to fit every tab: only the resize reports it.
    Object.defineProperty(list, "clientWidth", { value: 680 });
    act(() => resize(list));
    expect(list).not.toHaveAttribute("data-overflow-end");
  });
});

describe("revealDelta", () => {
  const strip = { left: 0, right: 200 };

  it.each([
    ["in view", { left: 100, right: 180 }, 0, 0],
    ["past the end", { left: 300, right: 380 }, 0, 180],
    ["before the start", { left: -150, right: -70 }, 0, -150],
    ["wider than the strip", { left: 50, right: 350 }, 0, 50],
    // More tabs follow: the tab's end stops the fade's width short.
    ["in view, clear of the fade", { left: 60, right: 140 }, 32, 0],
    ["in view, under the fade", { left: 100, right: 180 }, 32, 12],
    ["past the end, before more tabs", { left: 300, right: 380 }, 32, 212],
    [
      "before the start, before more tabs",
      { left: -150, right: -70 },
      32,
      -150,
    ],
    ["wider than the strip less the fade", { left: 50, right: 250 }, 32, 50],
  ])("scrolls a tab %s by its gap", (_case, tab, endFade, delta) => {
    expect(revealDelta(tab, strip, endFade)).toBe(delta);
  });
});

describe("hasOverflowEnd", () => {
  it.each([
    [0, 200, 680, true],
    [480, 200, 680, false],
    // A fractional width stops short of the true end by under a pixel.
    [479.5, 200, 680, false],
    [0, 200, 200, false],
  ])(
    "at scrollLeft %d, %d wide of %d: %s",
    (scrollLeft, clientWidth, scrollWidth, expected) => {
      expect(hasOverflowEnd({ scrollLeft, clientWidth, scrollWidth })).toBe(
        expected,
      );
    },
  );
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
