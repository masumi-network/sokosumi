import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMock, deleteMock, toastErrorMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/lib/actions/soko-bot/action", () => ({
  updateSokoBotScheduleAction: updateMock,
  deleteSokoBotScheduleAction: deleteMock,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastErrorMock },
}));

import { ScheduleRowActions } from "./schedule-row-actions.client";

const REFUSED = { ok: false, error: { message: "Core is down" } };

/** A write that stays open until the test answers or rejects it. */
function holdOpen(mock: typeof updateMock) {
  let answer: (value: unknown) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  mock.mockReturnValueOnce(
    new Promise((resolve, fail) => {
      answer = resolve;
      reject = fail;
    }),
  );
  return {
    answer: (value: unknown) => act(async () => answer(value)),
    reject: () => act(async () => reject(new Error("network down"))),
  };
}

describe("ScheduleRowActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves the switch before Core answers and moves it back when the write is refused", async () => {
    const write = holdOpen(updateMock);
    render(<ScheduleRowActions scheduleId="s1" enabled />);

    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch")).not.toBeChecked();

    await write.answer(REFUSED);
    expect(screen.getByRole("switch")).toBeChecked();
    expect(toastErrorMock).toHaveBeenCalledWith("Core is down");
  });

  it("moves the switch back when the call itself fails", async () => {
    const write = holdOpen(updateMock);
    render(<ScheduleRowActions scheduleId="s1" enabled={false} />);

    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch")).toBeChecked();

    await write.reject();
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(toastErrorMock).toHaveBeenCalledWith("updateError");
  });

  it("keeps the switch where it is when Core saves the write", async () => {
    const write = holdOpen(updateMock);
    render(<ScheduleRowActions scheduleId="s1" enabled />);

    fireEvent.click(screen.getByRole("switch"));
    await write.answer({ ok: true, value: null });

    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("goes back to the newest server state, not to the state before the click", async () => {
    const write = holdOpen(updateMock);
    const { rerender } = render(<ScheduleRowActions scheduleId="s1" enabled />);

    fireEvent.click(screen.getByRole("switch"));
    // Core saved the write and a read shows it, but the call's answer is lost.
    rerender(<ScheduleRowActions scheduleId="s1" enabled={false} />);
    await write.reject();

    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("follows the server when it reports another state", () => {
    const { rerender } = render(<ScheduleRowActions scheduleId="s1" enabled />);

    rerender(<ScheduleRowActions scheduleId="s1" enabled={false} />);

    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it.each([
    [
      "is refused",
      (write: ReturnType<typeof holdOpen>) => write.answer(REFUSED),
    ],
    ["fails", (write: ReturnType<typeof holdOpen>) => write.reject()],
  ])(
    "reports a delete at once, and takes it back when the write %s",
    async (_case, end) => {
      const write = holdOpen(deleteMock);
      const onRemovedChange = vi.fn();
      render(
        <ScheduleRowActions
          scheduleId="s1"
          enabled
          onRemovedChange={onRemovedChange}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "delete" }));
      fireEvent.click(
        await screen.findByRole("button", { name: "deleteConfirm" }),
      );
      expect(onRemovedChange.mock.calls).toEqual([[true]]);

      await end(write);
      expect(onRemovedChange.mock.calls).toEqual([[true], [false]]);
      expect(toastErrorMock).toHaveBeenCalledOnce();
    },
  );
});
