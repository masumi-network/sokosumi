import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UnreadThreadsPanel } from "@/app/chat/components/unread-threads-panel";

const labels = {
  open: "Threads",
  unreadThreads: (count: number) => `${count} unread threads`,
  unreadThreadsCapped: (max: number) => `More than ${max} unread threads`,
};

function renderTrigger(
  options: {
    isOpen?: boolean;
    onToggle?: () => void;
    unreadCount?: number;
    showUnreadCount?: boolean;
  } = {},
) {
  return render(
    <UnreadThreadsPanel
      labels={labels}
      isOpen={options.isOpen ?? false}
      onToggle={options.onToggle ?? vi.fn()}
      unreadCount={options.unreadCount ?? 0}
      showUnreadCount={options.showUnreadCount ?? false}
    />,
  );
}

describe("UnreadThreadsPanel", () => {
  it("toggles the thread list from the header control without an attention badge", () => {
    const onToggle = vi.fn();
    renderTrigger({ onToggle });

    expect(
      screen.queryByTestId("unread-threads-badge"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("unread-threads-panel"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("unread-threads-trigger"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: labels.open })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("stays quiet when the room holds no unread threads", () => {
    renderTrigger({ unreadCount: 0, showUnreadCount: true });

    const trigger = screen.getByTestId("unread-threads-trigger");
    expect(trigger).toHaveAttribute("data-unread", "false");
    expect(trigger).toHaveAccessibleName(labels.open);
    expect(trigger).toHaveTextContent("");
  });

  it("marks unread with a dot when counts are off", () => {
    renderTrigger({ unreadCount: 3, showUnreadCount: false });

    const trigger = screen.getByTestId("unread-threads-trigger");
    expect(trigger).toHaveAttribute("data-unread", "true");
    expect(trigger).toHaveAccessibleName("Threads, 3 unread threads");
    expect(trigger).toHaveTextContent("");
    // Without digits the dot is the whole visible statement.
    expect(screen.getByTestId("unread-threads-dot")).toBeInTheDocument();
  });

  it("stands the dot down once the number says it", () => {
    renderTrigger({ unreadCount: 3, showUnreadCount: true });

    expect(screen.queryByTestId("unread-threads-dot")).not.toBeInTheDocument();
  });

  it("shows no dot on a room with nothing unread", () => {
    renderTrigger({ unreadCount: 0, showUnreadCount: false });

    expect(screen.queryByTestId("unread-threads-dot")).not.toBeInTheDocument();
  });

  it("keeps the dot while the panel is open", () => {
    renderTrigger({ unreadCount: 3, showUnreadCount: false, isOpen: true });

    expect(screen.getByTestId("unread-threads-dot")).toBeInTheDocument();
  });

  it("shows the number when the reader opted in to counts", () => {
    renderTrigger({ unreadCount: 3, showUnreadCount: true });

    const trigger = screen.getByTestId("unread-threads-trigger");
    expect(trigger).toHaveAttribute("data-unread", "true");
    expect(trigger).toHaveTextContent("3");
    expect(trigger).toHaveAccessibleName("Threads, 3 unread threads");
  });

  it("caps a very loud room so the header cannot reflow", () => {
    renderTrigger({ unreadCount: 140, showUnreadCount: true });

    const trigger = screen.getByTestId("unread-threads-trigger");
    expect(trigger).toHaveTextContent("99+");
    // What it shows and what it says must agree past the cap.
    expect(trigger).toHaveAccessibleName(
      "Threads, More than 99 unread threads",
    );
  });

  it("still speaks the exact number at the cap itself", () => {
    renderTrigger({ unreadCount: 99, showUnreadCount: true });

    const trigger = screen.getByTestId("unread-threads-trigger");
    expect(trigger).toHaveTextContent("99");
    expect(trigger).toHaveAccessibleName("Threads, 99 unread threads");
  });

  // Opening the list is not reading it. The chrome stands down when the count
  // reaches zero, never because the panel happens to be open over it.
  it("keeps unread chrome while the panel is open", () => {
    renderTrigger({ unreadCount: 3, showUnreadCount: true, isOpen: true });

    const trigger = screen.getByTestId("unread-threads-trigger");
    expect(trigger).toHaveAttribute("data-unread", "true");
    expect(trigger).toHaveTextContent("3");
    expect(trigger).toHaveAccessibleName("Threads, 3 unread threads");
  });
});
