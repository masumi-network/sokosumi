import type { ChatRoom } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSendToChatDialog } from "./task-send-to-chat-dialog";

const { sendMock, pushMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/app/chat/actions", () => ({ sendRoomMessageAction: sendMock }));
vi.mock("@/app/chat/components/use-room-display-name", () => ({
  useRoomDisplayName: () => (room: ChatRoom) => room.name,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// A native select stands in for Radix Select, which happy-dom cannot open.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <select
      aria-label="roomLabel"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">-</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

const task = { id: "task-1", identifier: "SOK-1", name: "Weekly report" };
const rooms = [
  { id: "room-1", name: "general", kind: "channel" },
  { id: "room-2", name: "design", kind: "channel" },
] as ChatRoom[];

function renderDialog(onClose = vi.fn()) {
  render(
    <TaskSendToChatDialog
      task={task}
      rooms={rooms}
      currentUserId="user-1"
      onClose={onClose}
    />,
  );
  return onClose;
}

describe("TaskSendToChatDialog", () => {
  beforeEach(() => {
    sendMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("sends the note and Task link to the chosen room once", async () => {
    const user = userEvent.setup();
    sendMock.mockResolvedValue({ ok: true, value: {} });
    const onClose = renderDialog();

    expect(screen.getByRole("button", { name: "send" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("roomLabel"), "room-2");
    await user.type(screen.getByLabelText("noteLabel"), "Can you take this?");
    await user.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(
      "room-2",
      "Can you take this?\n\n[SOK-1 Weekly report](/tasks/SOK-1-weekly-report)",
      [],
      { clientMessageId: expect.any(String) },
    );
    expect(toast.success).toHaveBeenCalledWith(
      "success",
      expect.objectContaining({
        action: expect.objectContaining({ label: "openChat" }),
      }),
    );
    const action = vi.mocked(toast.success).mock.calls[0][1]?.action;
    if (!action || typeof action !== "object" || !("onClick" in action)) {
      throw new Error("Open chat action missing");
    }
    action.onClick({} as never);
    expect(pushMock).toHaveBeenCalledWith("/chat/rooms/room-2");
  });

  it("keeps the note and retries with the same message id after a failure", async () => {
    const user = userEvent.setup();
    sendMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "boom" },
    });
    const onClose = renderDialog();

    await user.selectOptions(screen.getByLabelText("roomLabel"), "room-1");
    await user.type(screen.getByLabelText("noteLabel"), "Please look");
    await user.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("error"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("noteLabel")).toHaveValue("Please look");

    sendMock.mockResolvedValueOnce({ ok: true, value: {} });
    await user.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [first, second] = sendMock.mock.calls;
    expect(second[3].clientMessageId).toBe(first[3].clientMessageId);
  });

  it("says when there is no room to send to", () => {
    render(
      <TaskSendToChatDialog
        task={task}
        rooms={[]}
        currentUserId="user-1"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("noRooms")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "send" })).toBeDisabled();
  });
});
