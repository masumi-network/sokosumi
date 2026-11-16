import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock, replaceMock, backMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
  backMock: vi.fn(),
}));

let mockPathname = "/chat";
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    back: backMock,
  }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME: 300,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const catalogs: Record<string, Record<string, string>> = {
      "App.Header.Search": {
        open: "Search",
        inputLabel: "Search history",
        searchPlaceholder: "Search...",
      },
      "App.Channels.MobileNav": {
        back: "Back",
      },
      "Components.NotificationCenter": {
        notifications: "Notifications",
        unreadBadge: "unread",
        unreadBadgeWithAccountNotice: "unread with notice",
        accountNoticeIndicator: "Account notice",
      },
    };
    return (key: string) => catalogs[namespace]?.[key] ?? `${namespace}.${key}`;
  },
}));

vi.mock("@/hooks/use-is-apple-platform", () => ({
  default: () => false,
}));

vi.mock("@/contexts/notification-provider", () => ({
  useNotifications: () => ({ unreadCount: 0 }),
}));

vi.mock("@/contexts/account-notice-provider", () => ({
  useAccountNotice: () => ({ notice: null }),
}));

vi.mock("@/app/components/header/notification-panel-content", () => ({
  NotificationPanelContent: () => <div data-testid="notification-panel" />,
}));

import { HeaderMobileSearchControl } from "@/app/components/header/header-mobile-search.client";
import { HeaderNotificationBell } from "@/app/components/header/header-notification-bell.client";
import { HeaderTrailingTools } from "@/app/components/header/header-trailing-tools";

describe("HeaderMobileSearchControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockPathname = "/chat";
    mockSearchParams = new URLSearchParams();
    window.history.replaceState({}, "", "/chat");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("expands search in the header chrome and opens /history", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    render(<HeaderMobileSearchControl />);

    expect(
      screen.queryByTestId("header-mobile-search-expanded"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(
      screen.getByTestId("header-mobile-search-expanded"),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
    expect(pushMock).toHaveBeenCalledWith("/history");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("does not re-push /history when already on the history page", async () => {
    mockPathname = "/history";
    window.history.replaceState({}, "", "/history");
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    render(<HeaderMobileSearchControl />);

    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(pushMock).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("header-mobile-search-expanded"),
    ).toBeInTheDocument();
  });

  it("uses the shared mobile back control and navigates back after opening from another page", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    const { rerender } = render(<HeaderMobileSearchControl />);

    await user.click(screen.getByRole("button", { name: "Search" }));
    const back = screen.getByRole("button", { name: "Back" });
    expect(back).toHaveAttribute("data-testid", "header-mobile-search-dismiss");
    expect(back.className).toMatch(/hover:bg-accent/);
    expect(back.className).toMatch(/rounded-md/);

    mockPathname = "/history";
    window.history.replaceState({}, "", "/history");
    rerender(<HeaderMobileSearchControl />);

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.queryByTestId("header-mobile-search-expanded"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
    expect(backMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not router.back when dismissed before /history push commits", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    const { rerender } = render(<HeaderMobileSearchControl />);

    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(pushMock).toHaveBeenCalledWith("/history");
    expect(mockPathname).toBe("/chat");

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(backMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("header-mobile-search-expanded"),
    ).not.toBeInTheDocument();

    mockPathname = "/history";
    window.history.replaceState({}, "", "/history");
    rerender(<HeaderMobileSearchControl />);

    expect(backMock).toHaveBeenCalledTimes(1);
  });

  it("collapses search on /history without router.back", async () => {
    mockPathname = "/history";
    window.history.replaceState({}, "", "/history");
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    render(<HeaderMobileSearchControl />);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.queryByTestId("header-mobile-search-expanded"),
    ).not.toBeInTheDocument();
    expect(backMock).not.toHaveBeenCalled();
  });

  it("filters the history page via URL q instead of opening a results popup", async () => {
    mockPathname = "/history";
    window.history.replaceState({}, "", "/history");
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    render(<HeaderMobileSearchControl />);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByPlaceholderText("Search..."), "brief");

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(replaceMock).toHaveBeenCalledWith("/history?q=brief");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("empties the box when the page clears the history search", async () => {
    mockPathname = "/history";
    mockSearchParams = new URLSearchParams("q=invoice");
    window.history.replaceState({}, "", "/history?q=invoice");
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    const { rerender } = render(<HeaderMobileSearchControl />);
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByPlaceholderText("Search...")).toHaveValue("invoice");

    // The empty state's "Clear filters" link drops q from the URL.
    mockSearchParams = new URLSearchParams();
    window.history.replaceState({}, "", "/history");
    rerender(<HeaderMobileSearchControl />);

    expect(screen.getByPlaceholderText("Search...")).toHaveValue("");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  /** Commits a URL the way a router navigation would, then re-renders. */
  function commitUrl(url: string, rerender: (ui: React.ReactElement) => void) {
    const [path, query = ""] = url.split("?");
    mockPathname = path;
    mockSearchParams = new URLSearchParams(query);
    window.history.replaceState({}, "", url);
    rerender(<HeaderMobileSearchControl />);
  }

  it("keeps Clear filters when it lands while typing is still pending", async () => {
    mockPathname = "/history";
    mockSearchParams = new URLSearchParams("q=invoice");
    window.history.replaceState({}, "", "/history?q=invoice");
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    const { rerender } = render(<HeaderMobileSearchControl />);
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByPlaceholderText("Search..."), "s");

    // Clear filters commits before the debounce for "invoices" fires.
    commitUrl("/history", rerender);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByPlaceholderText("Search...")).toHaveValue("");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("keeps newer typing when its own earlier query echoes back", async () => {
    mockPathname = "/history";
    window.history.replaceState({}, "", "/history");
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    const { rerender } = render(<HeaderMobileSearchControl />);
    await user.click(screen.getByRole("button", { name: "Search" }));
    const input = screen.getByPlaceholderText("Search...");
    await user.type(input, "brief");
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(replaceMock).toHaveBeenLastCalledWith("/history?q=brief");

    // More typing, then the slow navigation for "brief" commits.
    await user.type(input, "ing");
    commitUrl("/history?q=brief", rerender);
    expect(input).toHaveValue("briefing");

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(replaceMock).toHaveBeenLastCalledWith("/history?q=briefing");
    expect(input).toHaveValue("briefing");
  });

  it("keeps a query typed before arriving from a page with its own q", async () => {
    mockPathname = "/tasks/archived";
    mockSearchParams = new URLSearchParams("q=foo");
    window.history.replaceState({}, "", "/tasks/archived?q=foo");
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    const { rerender } = render(<HeaderMobileSearchControl />);
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByPlaceholderText("Search..."), "abc");

    // Delayed navigation lands on /history without q, then the flush echoes.
    commitUrl("/history", rerender);
    expect(screen.getByPlaceholderText("Search...")).toHaveValue("abc");
    expect(replaceMock).toHaveBeenLastCalledWith("/history?q=abc");
    commitUrl("/history?q=abc", rerender);
    expect(screen.getByPlaceholderText("Search...")).toHaveValue("abc");
  });

  it("applies a query typed before /history navigation finishes", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    const { rerender } = render(<HeaderMobileSearchControl />);

    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(pushMock).toHaveBeenCalledWith("/history");

    await user.type(screen.getByPlaceholderText("Search..."), "brief");

    // Debounce may fire while still off /history and no-op.
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(replaceMock).not.toHaveBeenCalled();

    mockPathname = "/history";
    window.history.replaceState({}, "", "/history");
    rerender(<HeaderMobileSearchControl />);

    expect(replaceMock).toHaveBeenCalledWith("/history?q=brief");
    expect(screen.getByPlaceholderText("Search...")).toHaveValue("brief");
  });

  it("flushes a still-pending query when /history navigation completes", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    const { rerender } = render(<HeaderMobileSearchControl />);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByPlaceholderText("Search..."), "brief");

    mockPathname = "/history";
    window.history.replaceState({}, "", "/history");
    rerender(<HeaderMobileSearchControl />);

    expect(replaceMock).toHaveBeenCalledWith("/history?q=brief");
  });

  it("cancels pending history query updates after navigating away", async () => {
    mockPathname = "/history";
    window.history.replaceState({}, "", "/history");
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    const { rerender } = render(<HeaderMobileSearchControl />);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByPlaceholderText("Search..."), "brief");

    mockPathname = "/chat";
    window.history.replaceState({}, "", "/chat");
    rerender(<HeaderMobileSearchControl />);

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(replaceMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("header-mobile-search-expanded"),
    ).not.toBeInTheDocument();
  });

  it("clears the history q param when dismissing expanded search", async () => {
    mockPathname = "/history";
    window.history.replaceState({}, "", "/history?q=brief");
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    render(<HeaderMobileSearchControl />);

    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByPlaceholderText("Search...")).toHaveValue("brief");

    await user.click(screen.getByTestId("header-mobile-search-dismiss"));

    expect(replaceMock).toHaveBeenCalledWith("/history");
  });

  it("keeps the collapsed control mobile-only for desktop chrome stability", () => {
    render(
      <>
        <HeaderNotificationBell />
        <HeaderMobileSearchControl />
      </>,
    );

    const trigger = screen.getByRole("button", { name: "Search" });
    expect(trigger.className).toMatch(/md:hidden/);
  });

  it("renders trailing tools without requiring organization context", () => {
    render(<HeaderTrailingTools />);

    expect(screen.getByTestId("header-trailing-tools")).toBeInTheDocument();
    const notifications = screen.getByRole("button", {
      name: "Notifications",
    });
    const search = screen.getByRole("button", { name: "Search" });
    expect(notifications).toBeInTheDocument();
    expect(search).toBeInTheDocument();
    expect(
      notifications.compareDocumentPosition(search) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps Notification Center and Search without Workspace chrome", () => {
    const { container } = render(<HeaderTrailingTools />);

    expect(screen.getByTestId("header-trailing-tools")).toBeInTheDocument();
    expect(
      container.querySelector("[data-testid='workspace-switcher-chrome']"),
    ).toBeNull();
  });
});
