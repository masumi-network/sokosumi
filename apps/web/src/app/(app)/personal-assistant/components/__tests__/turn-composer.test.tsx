import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startTurnMock = vi.fn();
const refreshMock = vi.fn();
const toastError = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock("@/lib/actions/soko-bot/action", () => ({
  startSokoBotTurnAction: (...args: unknown[]) => startTurnMock(...args),
}));

import { SOKO_BOT_BUSY_ERROR_CODE } from "@/lib/soko-bot/constants";

import { TurnComposer } from "../turn-composer.client";

describe("TurnComposer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is disabled while the bot is paused", () => {
    render(<TurnComposer botStatus="PAUSED" />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "send" })).toBeDisabled();
    expect(screen.getByText("pausedHint")).toBeInTheDocument();
  });

  it("is disabled while a turn is running and re-enables when idle or errored", () => {
    const { rerender } = render(<TurnComposer botStatus="RUNNING" />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "send" })).toBeDisabled();
    expect(screen.getByText("runningHint")).toBeInTheDocument();
    rerender(<TurnComposer botStatus="ERROR" />);
    expect(screen.getByRole("textbox")).toBeEnabled();
    rerender(<TurnComposer botStatus="IDLE" />);
    expect(screen.getByRole("textbox")).toBeEnabled();
  });

  it("sends a trimmed message with a fresh client turn id and clears on success", async () => {
    startTurnMock.mockResolvedValue({ ok: true, value: { turnId: "t1" } });
    render(<TurnComposer botStatus="IDLE" />);
    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "  Delegate the report  " } });
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(startTurnMock).toHaveBeenCalledTimes(1));
    const call = startTurnMock.mock.calls[0]?.[0] as {
      input: { clientTurnId: string; message: string };
    };
    expect(call.input.message).toBe("Delegate the report");
    expect(call.input.clientTurnId).toMatch(/[0-9a-f-]{36}/);
    await waitFor(() => expect(textbox).toHaveValue(""));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("re-sends the same clientTurnId after a lost response or failure, and mints a new one when the draft changes", async () => {
    startTurnMock
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR", message: "boom" },
      })
      .mockResolvedValue({ ok: true, value: { turnId: "t1" } });
    render(<TurnComposer botStatus="IDLE" />);
    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "Plan the launch" } });

    fireEvent.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(startTurnMock).toHaveBeenCalledTimes(1));
    const first = startTurnMock.mock.calls[0]?.[0] as {
      input: { clientTurnId: string; message: string };
    };
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(textbox).toHaveValue("Plan the launch");

    fireEvent.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(startTurnMock).toHaveBeenCalledTimes(2));
    const second = startTurnMock.mock.calls[1]?.[0] as {
      input: { clientTurnId: string; message: string };
    };
    expect(second.input).toEqual(first.input);
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));

    // Whitespace-only edits are not material: same id again on retry.
    fireEvent.change(textbox, { target: { value: "  Plan the launch " } });
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(startTurnMock).toHaveBeenCalledTimes(3));
    const third = startTurnMock.mock.calls[2]?.[0] as {
      input: { clientTurnId: string; message: string };
    };
    expect(third.input.clientTurnId).toBe(first.input.clientTurnId);
    await waitFor(() => expect(textbox).toHaveValue(""));
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // A materially different draft gets a fresh id.
    fireEvent.change(textbox, { target: { value: "Different request" } });
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(startTurnMock).toHaveBeenCalledTimes(4));
    const fourth = startTurnMock.mock.calls[3]?.[0] as {
      input: { clientTurnId: string; message: string };
    };
    expect(fourth.input.message).toBe("Different request");
    expect(fourth.input.clientTurnId).not.toBe(first.input.clientTurnId);
  });

  it("uses a new clientTurnId when the draft changes after a failure", async () => {
    startTurnMock.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "boom" },
    });
    render(<TurnComposer botStatus="IDLE" />);
    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "First draft" } });
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(startTurnMock).toHaveBeenCalledTimes(1));
    fireEvent.change(textbox, { target: { value: "Second draft" } });
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(startTurnMock).toHaveBeenCalledTimes(2));
    const [a, b] = startTurnMock.mock.calls.map(
      (call) =>
        (call[0] as { input: { clientTurnId: string } }).input.clientTurnId,
    );
    expect(a).not.toBe(b);
  });

  it("shows the busy message when Core reports 409 and keeps the draft", async () => {
    startTurnMock.mockResolvedValue({
      ok: false,
      error: { code: SOKO_BOT_BUSY_ERROR_CODE, message: "busy" },
    });
    render(<TurnComposer botStatus="IDLE" />);
    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "Another one" } });
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("busy"));
    expect(textbox).toHaveValue("Another one");
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
