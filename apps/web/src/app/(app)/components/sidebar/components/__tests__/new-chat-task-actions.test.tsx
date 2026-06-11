import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/",
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/use-is-apple-platform", () => ({
  default: () => false,
}));

vi.mock("@/components/ui/sheet", () => ({
  SheetClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <ul>{children}</ul>
  ),
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => (
    <li>{children}</li>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <li>{children}</li>
  ),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

import NewChatTaskActions from "@/app/components/sidebar/components/new-chat-task-actions";

describe("NewChatTaskActions keyboard shortcut", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it("does not throw when event.key is undefined", () => {
    render(<NewChatTaskActions />);

    expect(() => {
      fireEvent.keyDown(window, { key: undefined, metaKey: true });
    }).not.toThrow();

    expect(pushMock).not.toHaveBeenCalled();
  });

  it("navigates to /chat on Cmd+K", () => {
    render(<NewChatTaskActions />);

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(pushMock).toHaveBeenCalledWith("/chat");
  });

  it("navigates to /chat on Ctrl+K", () => {
    render(<NewChatTaskActions />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(pushMock).toHaveBeenCalledWith("/chat");
  });

  it("ignores Cmd+K when an input element is the event target", () => {
    render(<NewChatTaskActions />);
    const input = document.createElement("input");
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: "k", metaKey: true });

    expect(pushMock).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it("ignores non-matching keys", () => {
    render(<NewChatTaskActions />);

    fireEvent.keyDown(window, { key: "j", metaKey: true });

    expect(pushMock).not.toHaveBeenCalled();
  });
});
