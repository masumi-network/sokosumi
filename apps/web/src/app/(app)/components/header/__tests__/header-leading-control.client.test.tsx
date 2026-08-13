import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TASKS_RETURN_PATH_SESSION_KEY } from "@/app/tasks/components/task-navigation";

let mockPathname = "/chat";
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

import { HeaderLeadingControl } from "../header-leading-control.client";

describe("HeaderLeadingControl", () => {
  beforeEach(() => {
    mockPathname = "/chat";
    mockSearchParams = new URLSearchParams();
    window.sessionStorage.clear();
    routerPushMock.mockClear();
  });

  it("shows brand on home", () => {
    render(<HeaderLeadingControl />);
    expect(screen.getByTestId("sokosumi-icon")).toBeTruthy();
  });

  it("shows brand on chats list", () => {
    mockPathname = "/chat/chats";
    render(<HeaderLeadingControl />);
    expect(screen.getByTestId("sokosumi-icon")).toBeTruthy();
  });

  it("shows back to chats on room", () => {
    mockPathname = "/chat/rooms/r1";
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "backToChats" });
    expect(back).toHaveAttribute("href", "/chat");
  });

  it("shows back to chats on draft DM compose", () => {
    mockSearchParams = new URLSearchParams("dm=new");
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "backToChats" });
    expect(back).toHaveAttribute("href", "/chat");
  });

  it("shows back to chats on account (not sidebar trigger)", () => {
    mockPathname = "/account";
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "backToChats" });
    expect(back).toHaveAttribute("href", "/chat");
    expect(
      screen.queryByRole("button", { name: "sidebar-trigger" }),
    ).toBeNull();
  });

  it("shows back to chats on billing", () => {
    mockPathname = "/billing";
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "backToChats" });
    expect(back).toHaveAttribute("href", "/chat");
  });

  it("shows back to chats on developer", () => {
    mockPathname = "/developer";
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "backToChats" });
    expect(back).toHaveAttribute("href", "/chat");
  });

  it("shows brand on tasks list root", () => {
    mockPathname = "/tasks";
    render(<HeaderLeadingControl />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("sokosumi-icon")).toBeTruthy();
  });

  it("shows brand on agents, projects, and search tab roots", () => {
    for (const path of ["/agents", "/projects", "/history"]) {
      mockPathname = path;
      const { unmount } = render(<HeaderLeadingControl />);
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByTestId("sokosumi-icon")).toBeTruthy();
      unmount();
    }
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
});
