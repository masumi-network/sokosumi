import type { ChatRoom } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { TaskSendToChatDialog } from "./task-send-to-chat-dialog";

const { sendMock, pushMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/app/chat/actions", () => ({ sendTaskToChatAction: sendMock }));
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
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    disabled?: boolean;
    children: ReactNode;
  }) => (
    <select
      aria-label="roomLabel"
      value={value}
      disabled={disabled}
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

const rooms = [
  { id: "room-1", name: "general", kind: "channel" },
  { id: "room-2", name: "design", kind: "channel" },
] as ChatRoom[];

const lostResponse = {
  ok: false,
  error: { code: CommonErrorCode.INTERNAL_SERVER_ERROR, message: "error" },
};

function renderDialog(onClose = vi.fn()) {
  render(
    <TaskSendToChatDialog
      taskId="task-1"
      rooms={rooms}
      currentUserId="user-1"
      onClose={onClose}
    />,
  );
  return onClose;
}

async function fill(user: ReturnType<typeof userEvent.setup>, note: string) {
  await user.selectOptions(screen.getByLabelText("roomLabel"), "room-1");
  await user.type(screen.getByLabelText("noteLabel"), note);
}

describe("TaskSendToChatDialog", () => {
  beforeEach(() => {
    sendMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("sends the Task id, room and note, then offers the chat", async () => {
    const user = userEvent.setup();
    sendMock.mockResolvedValue({ ok: true, value: {} });
    const onClose = renderDialog();

    expect(screen.getByRole("button", { name: "send" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("roomLabel"), "room-2");
    await user.type(screen.getByLabelText("noteLabel"), "Can you take this?");
    await user.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith("task-1", {
      roomId: "room-2",
      note: "Can you take this?",
      clientMessageId: expect.any(String),
    });
    const action = vi.mocked(toast.success).mock.calls[0][1]?.action;
    if (!action || typeof action !== "object" || !("onClick" in action)) {
      throw new Error("Open chat action missing");
    }
    action.onClick({} as never);
    expect(pushMock).toHaveBeenCalledWith("/chat/rooms/room-2");
  });

  it("locks the fields while a send runs", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => {};
    sendMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderDialog();

    await fill(user, "Please look");
    await user.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() =>
      expect(screen.getByLabelText("roomLabel")).toBeDisabled(),
    );
    expect(screen.getByLabelText("noteLabel")).toBeDisabled();
    expect(screen.getByRole("button", { name: "cancel" })).toBeDisabled();
    finish({ ok: true, value: {} });
  });

  it("retries a lost response as the same attempt, so it lands once", async () => {
    const user = userEvent.setup();
    sendMock.mockResolvedValueOnce(lostResponse);
    const onClose = renderDialog();

    await fill(user, "Please look");
    await user.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("error"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("noteLabel")).toHaveValue("Please look");
    expect(screen.getByRole("status")).toHaveTextContent("retryHint");

    sendMock.mockResolvedValueOnce({ ok: true, value: {} });
    await user.click(screen.getByRole("button", { name: "retry" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [first, second] = sendMock.mock.calls;
    expect(second[1]).toEqual(first[1]);
  });

  it("sends an edited note as a new attempt with a new id", async () => {
    const user = userEvent.setup();
    sendMock.mockResolvedValueOnce(lostResponse);
    renderDialog();

    await fill(user, "Please look");
    await user.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    await user.type(screen.getByLabelText("noteLabel"), " today");
    expect(screen.queryByRole("status")).toBeNull();
    sendMock.mockResolvedValueOnce({ ok: true, value: {} });
    await user.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(2));
    const [first, second] = sendMock.mock.calls;
    expect(second[1].note).toBe("Please look today");
    expect(second[1].clientMessageId).not.toBe(first[1].clientMessageId);
  });

  it("sends to a changed room as a new attempt with a new id", async () => {
    const user = userEvent.setup();
    sendMock.mockResolvedValueOnce(lostResponse);
    renderDialog();

    await fill(user, "Please look");
    await user.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText("roomLabel"), "room-2");
    sendMock.mockResolvedValueOnce({ ok: true, value: {} });
    await user.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(2));
    const [first, second] = sendMock.mock.calls;
    expect(second[1].roomId).toBe("room-2");
    expect(second[1].clientMessageId).not.toBe(first[1].clientMessageId);
  });

  it("does not offer a retry after Core refuses the room", async () => {
    const user = userEvent.setup();
    sendMock.mockResolvedValueOnce({
      ok: false,
      error: { code: CommonErrorCode.UNAUTHORIZED, message: "refused" },
    });
    renderDialog();

    await fill(user, "Please look");
    await user.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("refused"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "send" })).toBeEnabled();
  });

  it("says when there is no room to send to", () => {
    render(
      <TaskSendToChatDialog
        taskId="task-1"
        rooms={[]}
        currentUserId="user-1"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("noRooms")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "send" })).toBeDisabled();
  });
});
