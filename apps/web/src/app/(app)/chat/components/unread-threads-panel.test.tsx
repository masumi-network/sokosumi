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
  } = {},
) {
  return render(
    <UnreadThreadsPanel
      labels={labels}
      isOpen={options.isOpen ?? false}
      onToggle={options.onToggle ?? vi.fn()}
      unreadCount={options.unreadCount ?? 0}
    />,
  );
}

describe("UnreadThreadsPanel", () => {
  it("toggles the thread list from the header control", () => {
    const onToggle = vi.fn();
    renderTrigger({ onToggle });

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
    renderTrigger({ unreadCount: 0 });

    const trigger = screen.getByTestId("unread-threads-trigger");
    expect(trigger).toHaveAttribute("data-unread", "false");
    expect(trigger).toHaveAccessibleName(labels.open);
    expect(trigger).toHaveTextContent("");
    expect(
      screen.queryByTestId("unread-threads-badge"),
    ).not.toBeInTheDocument();
  });

  // The numeric-counts preference thins the sidebar; it never reaches this
  // control, so every reader sees the number.
  it("badges the unread thread count on the icon", () => {
    renderTrigger({ unreadCount: 3 });

    const trigger = screen.getByTestId("unread-threads-trigger");
    expect(trigger).toHaveAttribute("data-unread", "true");
    expect(trigger).toHaveAccessibleName("Threads, 3 unread threads");
    expect(screen.getByTestId("unread-threads-badge")).toHaveTextContent("3");
  });

  // The badge replaced the dot outright; no state is left for it.
  it.each([
    { unreadCount: 0, isOpen: false },
    { unreadCount: 3, isOpen: false },
    { unreadCount: 3, isOpen: true },
    { unreadCount: 140, isOpen: false },
  ])("draws no dot at $unreadCount unread, open: $isOpen", (options) => {
    renderTrigger(options);

    expect(screen.queryByTestId("unread-threads-dot")).not.toBeInTheDocument();
  });

  it("caps a very loud room so the badge cannot outgrow the icon", () => {
    renderTrigger({ unreadCount: 140 });

    expect(screen.getByTestId("unread-threads-badge")).toHaveTextContent("99+");
    // What it shows and what it says must agree past the cap.
    expect(screen.getByTestId("unread-threads-trigger")).toHaveAccessibleName(
      "Threads, More than 99 unread threads",
    );
  });

  it("still shows and speaks the exact number at the cap itself", () => {
    renderTrigger({ unreadCount: 99 });

    expect(screen.getByTestId("unread-threads-badge")).toHaveTextContent(
      /^99$/,
    );
    expect(screen.getByTestId("unread-threads-trigger")).toHaveAccessibleName(
      "Threads, 99 unread threads",
    );
  });

  // Opening the list is not reading it. The badge stands down when the count
  // reaches zero, never because the panel happens to be open over it.
  it("keeps the badge while the panel is open", () => {
    renderTrigger({ unreadCount: 3, isOpen: true });

    const trigger = screen.getByTestId("unread-threads-trigger");
    expect(trigger).toHaveAttribute("data-unread", "true");
    expect(screen.getByTestId("unread-threads-badge")).toHaveTextContent("3");
    expect(trigger).toHaveAccessibleName("Threads, 3 unread threads");
  });
});
