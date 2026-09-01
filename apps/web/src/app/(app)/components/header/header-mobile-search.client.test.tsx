import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getHistoryMock, pushMock } = vi.hoisted(() => ({
  getHistoryMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getHistory: getHistoryMock,
  },
}));

vi.mock("@/components/agents/agent-icon", () => ({
  AgentIcon: () => <span data-testid="agent-icon" />,
}));

vi.mock("@/app/tasks/components/task-status-badge", () => ({
  TaskStatusBadge: () => <span data-testid="task-status-badge" />,
}));

vi.mock("@/components/jobs/job-status-badge", () => ({
  JobStatusBadge: () => <span data-testid="job-status-badge" />,
}));

vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({
    formatTimeAgo: (date: string | Date) =>
      new Date(date).toISOString().split("T")[0],
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const catalogs: Record<string, Record<string, string>> = {
      "App.Header.Search": {
        open: "Search",
        inputLabel: "Search history",
        dismiss: "Close search",
        dismissBackdrop: "Dismiss search",
        searchPlaceholder: "Search...",
        empty: "No results found",
        loading: "Loading...",
        error: "Failed to load results",
        resultsHeading: "Search",
      },
      "App.History": {
        "Row.updated": "Updated",
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

import { HeaderMobileSearchControl } from "@/app/components/header/header-mobile-search.client";
import { HeaderNotificationBell } from "@/app/components/header/header-notification-bell.client";
import { HeaderTrailingTools } from "@/app/components/header/header-trailing-tools";
import {
  HISTORY_SEARCH_DEBOUNCE_MS,
  HISTORY_SEARCH_PAGE_SIZE,
} from "@/app/components/use-history-search-corpus";
import type { HistoryItem } from "@/lib/clients/generated/core/types.gen";

vi.mock("@/contexts/notification-provider", () => ({
  useNotifications: () => ({ unreadCount: 0 }),
}));

vi.mock("@/contexts/account-notice-provider", () => ({
  useAccountNotice: () => ({ notice: null }),
}));

vi.mock("@/app/components/header/notification-dropdown-content", () => ({
  NotificationDropdownContent: () => (
    <div data-testid="notification-dropdown" />
  ),
}));

function createTaskItem(id: string, title: string): HistoryItem {
  return {
    id,
    kind: "task",
    title,
    status: "DRAFT",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    description: null,
    credits: null,
    projectId: null,
    coworkerId: null,
    owner: null,
  };
}

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("HeaderTrailingTools", () => {
  it("places Search immediately after Notification Center", () => {
    renderWithQuery(<HeaderTrailingTools activeOrganizationId={null} />);

    const tools = screen.getByTestId("header-trailing-tools");
    const buttons = within(tools).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Notifications",
      "Search",
    ]);
  });
});

describe("HeaderMobileSearchControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getHistoryMock.mockResolvedValue({
      data: [createTaskItem("task-1", "Draft brief")],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("expands search in the header chrome without navigating to /history", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    renderWithQuery(<HeaderMobileSearchControl activeOrganizationId={null} />);

    expect(
      screen.queryByTestId("header-mobile-search-expanded"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(
      screen.getByTestId("header-mobile-search-expanded"),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("dismisses expanded search and restores the trigger", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    renderWithQuery(<HeaderMobileSearchControl activeOrganizationId={null} />);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(screen.getByTestId("header-mobile-search-dismiss"));

    expect(
      screen.queryByTestId("header-mobile-search-expanded"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("queries the history-search corpus and navigates on result select", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    renderWithQuery(<HeaderMobileSearchControl activeOrganizationId="org-1" />);

    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(getHistoryMock).toHaveBeenCalledWith({
        q: undefined,
        limit: HISTORY_SEARCH_PAGE_SIZE,
        scope: "owned",
        types: ["task", "job"],
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Draft brief")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Draft brief"));

    expect(pushMock).toHaveBeenCalledWith("/tasks/task-1");
    expect(
      screen.queryByTestId("header-mobile-search-expanded"),
    ).not.toBeInTheDocument();
  });

  it("keeps the collapsed control mobile-only for desktop chrome stability", () => {
    renderWithQuery(
      <>
        <HeaderNotificationBell />
        <HeaderMobileSearchControl activeOrganizationId={null} />
      </>,
    );

    const trigger = screen.getByRole("button", { name: "Search" });
    expect(trigger.className).toMatch(/md:hidden/);
  });

  it("debounces typed queries through the shared history corpus", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    renderWithQuery(<HeaderMobileSearchControl activeOrganizationId={null} />);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByPlaceholderText("Search..."), "brief");

    await act(async () => {
      vi.advanceTimersByTime(HISTORY_SEARCH_DEBOUNCE_MS);
    });

    await waitFor(() => {
      expect(getHistoryMock).toHaveBeenLastCalledWith({
        q: "brief",
        limit: HISTORY_SEARCH_PAGE_SIZE,
        scope: "owned",
        types: ["task", "job"],
      });
    });
  });
});
