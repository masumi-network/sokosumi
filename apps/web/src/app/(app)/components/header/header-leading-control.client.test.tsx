import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  TASKS_RETURN_PATH_SESSION_KEY,
  TASKS_RETURN_TASK_SESSION_KEY,
} from "@/app/tasks/components/task-navigation";

let mockPathname = "/";
let mockSearchParams = new URLSearchParams();
const routerPushMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({
    push: routerPushMock,
    prefetch: vi.fn(),
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/masumi-logos", () => ({
  SokosumiIcon: ({ className }: { className?: string }) => (
    <span data-testid="sokosumi-icon" className={className} />
  ),
}));

import { MarkAgentUnavailable } from "@/app/components/unavailable-agent.client";
import { HeaderLeadingControl } from "./header-leading-control.client";

describe("HeaderLeadingControl", () => {
  beforeEach(() => {
    mockPathname = "/";
    mockSearchParams = new URLSearchParams();
    window.sessionStorage.clear();
    routerPushMock.mockClear();
  });

  it("keeps the newsletter project when returning from an issue", () => {
    mockPathname = "/newsletter/issues/issue-1";
    mockSearchParams = new URLSearchParams(
      "projectId=project%2Fone&draftedBySokoBot=true",
    );
    render(<HeaderLeadingControl />);
    expect(screen.getByRole("link", { name: "back" })).toHaveAttribute(
      "href",
      "/newsletter/issues?projectId=project%2Fone",
    );
  });

  it("shows brand link to home on Welcome", () => {
    render(<HeaderLeadingControl />);
    expect(screen.getByTestId("sokosumi-icon")).toBeTruthy();
    expect(screen.getByRole("link", { name: "goHome" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("shows brand link to home on chats list", () => {
    mockPathname = "/chat";
    render(<HeaderLeadingControl />);
    expect(screen.getByTestId("sokosumi-icon")).toBeTruthy();
    expect(screen.getByRole("link", { name: "goHome" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("shows back to chats on room", () => {
    mockPathname = "/chat/rooms/r1";
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "backToChats" });
    expect(back).toHaveAttribute("href", "/chat");
  });

  it("treats leftover compose queries as home chrome", () => {
    mockPathname = "/";
    mockSearchParams = new URLSearchParams("dm=new");
    render(<HeaderLeadingControl />);
    expect(screen.getByTestId("sokosumi-icon")).toBeTruthy();
    expect(screen.getByRole("link", { name: "goHome" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("shows back to You on account (not sidebar trigger)", () => {
    mockPathname = "/account";
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "backToYou" });
    expect(back).toHaveAttribute("href", "/you");
    expect(
      screen.queryByRole("button", { name: "sidebar-trigger" }),
    ).toBeNull();
  });

  it("shows back to You on billing", () => {
    mockPathname = "/billing";
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "backToYou" });
    expect(back).toHaveAttribute("href", "/you");
  });

  it("shows back to the Developer menu on a developer section", () => {
    mockPathname = "/developer/api-keys";
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "back" });
    expect(back).toHaveAttribute("href", "/you/developer");
  });

  it("shows brand link to home on tasks list root", () => {
    mockPathname = "/tasks";
    render(<HeaderLeadingControl />);
    expect(screen.getByRole("link", { name: "goHome" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByTestId("sokosumi-icon")).toBeTruthy();
  });

  it("shows brand link to home on projects and You tab roots", () => {
    for (const path of ["/projects", "/you"]) {
      mockPathname = path;
      const { unmount } = render(<HeaderLeadingControl />);
      expect(screen.getByRole("link", { name: "goHome" })).toHaveAttribute(
        "href",
        "/",
      );
      expect(screen.getByTestId("sokosumi-icon")).toBeTruthy();
      unmount();
    }
  });

  it.each([
    "/history",
    "/agents",
    "/schedules",
    "/calendar",
    "/studio",
    "/tiktok-studio",
    "/social",
    "/contacts",
    "/drive",
  ])("shows a named back to You on %s opened from You", (pathname) => {
    mockPathname = pathname;
    mockSearchParams = new URLSearchParams("from=you");
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "backToYou" });
    expect(back).toHaveAttribute("href", "/you");
    expect(back).toHaveTextContent("you");
    expect(screen.queryByTestId("sokosumi-icon")).toBeNull();
  });

  it("keeps a project-scoped TikTok Studio opened from You going back to You", () => {
    mockPathname = "/tiktok-studio";
    mockSearchParams = new URLSearchParams("project=p1&from=you");
    render(<HeaderLeadingControl />);
    expect(screen.getByRole("link", { name: "backToYou" })).toHaveAttribute(
      "href",
      "/you",
    );
  });

  it("keeps a nested page of a You row going back to its list", () => {
    mockPathname = "/agents/a1";
    mockSearchParams = new URLSearchParams("from=you");
    render(<HeaderLeadingControl />);
    expect(screen.getByRole("link", { name: "back" })).toHaveAttribute(
      "href",
      "/agents",
    );
  });

  // A project's post preview opens its Social accounts: not from You.
  it("keeps Social opened from a project going back to Home", () => {
    mockPathname = "/social";
    mockSearchParams = new URLSearchParams("projectId=p1&tab=accounts");
    render(<HeaderLeadingControl />);
    expect(screen.getByRole("link", { name: "back" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  // Each history entry carries its own marker, so Back and Forward restore
  // the chrome of the visit they land on.
  it("restores each Contacts visit's own chrome on Back and Forward", () => {
    const visits = [
      ["", "goHome"], // Contacts opened from a task
      ["from=you", "backToYou"], // then from You
      ["", "goHome"], // Back to the earlier visit
      ["from=you", "backToYou"], // Forward again
    ] as const;
    for (const [search, name] of visits) {
      mockPathname = "/contacts";
      mockSearchParams = new URLSearchParams(search);
      const { unmount } = render(<HeaderLeadingControl />);
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
      unmount();
    }
  });

  it("keeps Contacts opened fresh from Newsletter on its own chrome", () => {
    mockPathname = "/contacts";
    mockSearchParams = new URLSearchParams("contact=c1");
    render(<HeaderLeadingControl />);
    expect(screen.getByTestId("sokosumi-icon")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "backToYou" })).toBeNull();
  });

  it("keeps brand link on /history opened from a task", () => {
    mockPathname = "/history";
    render(<HeaderLeadingControl />);
    expect(screen.getByRole("link", { name: "goHome" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("keeps back to home on Agents opened from elsewhere", () => {
    mockPathname = "/agents";
    render(<HeaderLeadingControl />);
    expect(screen.getByRole("link", { name: "back" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("keeps an icon-only back on other pages", () => {
    mockPathname = "/tasks/t1";
    render(<HeaderLeadingControl />);
    expect(screen.getByRole("link", { name: "back" })).toHaveTextContent("");
  });

  it("returns from an agent's job to that agent", () => {
    mockPathname = "/agents/a1/jobs/j1";
    render(<HeaderLeadingControl />);
    expect(screen.getByRole("link", { name: "back" })).toHaveAttribute(
      "href",
      "/agents/a1",
    );
  });

  it("returns from an unavailable agent's job to the catalog", () => {
    mockPathname = "/agents/a1/jobs/j1";
    const { unmount } = render(
      <>
        <HeaderLeadingControl />
        <MarkAgentUnavailable agentId="a1" />
      </>,
    );
    expect(screen.getByRole("link", { name: "back" })).toHaveAttribute(
      "href",
      "/agents",
    );
    // Leaving the jobs layout clears the mark for the next visit.
    unmount();
    render(<HeaderLeadingControl />);
    expect(screen.getByRole("link", { name: "back" })).toHaveAttribute(
      "href",
      "/agents/a1",
    );
  });

  it("shows back to chats on personal-assistant root", () => {
    mockPathname = "/personal-assistant";
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "backToChats" });
    expect(back).toHaveAttribute("href", "/chat");
  });

  it("shows back to list root on nested tasks", () => {
    mockPathname = "/tasks/t1";
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "back" });
    expect(back).toHaveAttribute("href", "/tasks");
  });

  it("shows back to You on You submenu stacks", () => {
    for (const path of ["/you/developer", "/you/help", "/you/legal"]) {
      mockPathname = path;
      const { unmount } = render(<HeaderLeadingControl />);
      const back = screen.getByRole("link", { name: "backToYou" });
      expect(back).toHaveAttribute("href", "/you");
      unmount();
    }
  });

  it("restores stored tasks view and filters on nested tasks back", async () => {
    window.sessionStorage.setItem(
      TASKS_RETURN_PATH_SESSION_KEY,
      "/tasks?view=list&status=todo",
    );
    mockPathname = "/tasks/t1";
    render(<HeaderLeadingControl />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "back" })).toHaveAttribute(
        "href",
        "/tasks?view=list&status=todo",
      );
    });
  });

  it("re-reads stored return path after list→detail without remounting header", async () => {
    // Header chrome stays mounted across navigations. Mount on the list first
    // (empty storage → /tasks), then store filters and move to detail.
    mockPathname = "/tasks";
    const { rerender } = render(<HeaderLeadingControl />);
    expect(screen.getByTestId("sokosumi-icon")).toBeTruthy();

    window.sessionStorage.setItem(
      TASKS_RETURN_PATH_SESSION_KEY,
      "/tasks?view=list&status=todo",
    );
    mockPathname = "/tasks/t1";
    rerender(<HeaderLeadingControl />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "back" })).toHaveAttribute(
        "href",
        "/tasks?view=list&status=todo",
      );
    });

    fireEvent.click(screen.getByRole("link", { name: "back" }));
    expect(routerPushMock).toHaveBeenCalledWith("/tasks?view=list&status=todo");
  });

  it.each([
    { pathname: "/tasks/task-a", href: "/calendar?view=agenda" },
    // Reached later from a notification or a pasted link.
    { pathname: "/tasks/task-b", href: "/tasks" },
    { pathname: "/tasks/archived", href: "/tasks" },
  ])(
    "goes back to the Calendar only from the task opened there ($pathname)",
    async ({ pathname, href }) => {
      window.sessionStorage.setItem(
        TASKS_RETURN_PATH_SESSION_KEY,
        "/calendar?view=agenda",
      );
      window.sessionStorage.setItem(
        TASKS_RETURN_TASK_SESSION_KEY,
        "/tasks/task-a",
      );
      mockPathname = pathname;
      render(<HeaderLeadingControl />);

      await waitFor(() => {
        expect(screen.getByRole("link", { name: "back" })).toHaveAttribute(
          "href",
          href,
        );
      });
      fireEvent.click(screen.getByRole("link", { name: "back" }));
      expect(routerPushMock).toHaveBeenCalledWith(href);
    },
  );
});
