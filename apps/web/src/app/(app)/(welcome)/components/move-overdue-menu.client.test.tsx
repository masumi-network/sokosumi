import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { moveOverdueTasks, undoMoveOverdueTasks, refresh, toast } = vi.hoisted(
  () => ({
    moveOverdueTasks: vi.fn(),
    undoMoveOverdueTasks: vi.fn(),
    refresh: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  }),
);

function translate(key: string, values?: Record<string, unknown>): string {
  return values ? `${key}:${JSON.stringify(values)}` : key;
}

vi.mock("next-intl", () => ({
  useTranslations: () => translate,
  useFormatter: () => ({ dateTime: (date: Date) => date.toISOString() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast }));
vi.mock("../actions", () => ({ moveOverdueTasks, undoMoveOverdueTasks }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect: () => void;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
}));

import { MoveOverdueMenu } from "./move-overdue-menu.client";

describe("MoveOverdueMenu", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("names the count and each target day before moving", () => {
    // Thursday 12 November 2026.
    render(<MoveOverdueMenu today="2026-11-12" count={3} />);

    expect(screen.getByText('trigger:{"count":3}')).toBeTruthy();
    expect(screen.getByText('label:{"count":3}')).toBeTruthy();
    expect(screen.getByText("2026-11-12T12:00:00.000Z")).toBeTruthy();
    expect(screen.getByText("2026-11-13T12:00:00.000Z")).toBeTruthy();
    expect(screen.getByText("2026-11-16T12:00:00.000Z")).toBeTruthy();
  });

  it("moves to the chosen day, then Undo puts the moved Tasks back", async () => {
    const moved = [{ id: "a", from: "2026-11-01" }];
    moveOverdueTasks.mockResolvedValue({ moved, tried: 1 });
    undoMoveOverdueTasks.mockResolvedValue(1);
    render(<MoveOverdueMenu today="2026-11-12" count={1} />);

    fireEvent.click(screen.getByText("targets.tomorrow"));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(moveOverdueTasks).toHaveBeenCalledWith({
      today: "2026-11-12",
      to: "2026-11-13",
    });
    expect(refresh).toHaveBeenCalled();
    const [message, options] = toast.success.mock.calls[0] ?? [];
    expect(message).toBe('moved:{"count":1,"date":"2026-11-13T12:00:00.000Z"}');

    options.action.onClick();
    await waitFor(() =>
      expect(undoMoveOverdueTasks).toHaveBeenCalledWith({
        to: "2026-11-13",
        moved,
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenLastCalledWith('undone:{"count":1}'),
    );
  });

  it("says when only some Tasks moved", async () => {
    moveOverdueTasks.mockResolvedValue({
      moved: [{ id: "a", from: "2026-11-01" }],
      tried: 3,
    });
    render(<MoveOverdueMenu today="2026-11-12" count={3} />);

    fireEvent.click(screen.getByText("targets.today"));

    await waitFor(() =>
      expect(toast.success.mock.calls[0]?.[0]).toBe(
        'movedPartly:{"count":1,"total":3,"date":"2026-11-12T12:00:00.000Z"}',
      ),
    );
  });

  it("shows an error and changes nothing when the move fails", async () => {
    moveOverdueTasks.mockResolvedValue(null);
    render(<MoveOverdueMenu today="2026-11-12" count={2} />);

    fireEvent.click(screen.getByText("targets.nextMonday"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("error"));
    expect(moveOverdueTasks).toHaveBeenCalledWith({
      today: "2026-11-12",
      to: "2026-11-16",
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
