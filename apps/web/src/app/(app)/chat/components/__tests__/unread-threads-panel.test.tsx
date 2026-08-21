import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UnreadThreadsPanel } from "@/app/chat/components/unread-threads-panel";

const labels = {
  open: "Threads",
};

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";

function renderTrigger(
  options: { isOpen?: boolean; onToggle?: () => void } = {},
) {
  return render(
    <UnreadThreadsPanel
      roomId={ROOM_ID}
      labels={labels}
      isOpen={options.isOpen ?? false}
      onToggle={options.onToggle ?? vi.fn()}
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
});
