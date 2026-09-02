import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const performMock = vi.fn();
const refreshMock = vi.fn();
const OPERATION_ASSERTION_TIMEOUT_MS = 5_000;
const RETRY_FLOW_TEST_TIMEOUT_MS = OPERATION_ASSERTION_TIMEOUT_MS * 4;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions/admin-soko-bots/action", () => ({
  performAdminSokoBotAction: (...args: unknown[]) => performMock(...args),
}));

import { AdminSokoBotActions } from "../admin-soko-bot-actions.client";

describe("AdminSokoBotActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables Resume unless admin-paused and Retry without a failed turn", () => {
    render(
      <AdminSokoBotActions
        sokoBotId="bot_1"
        status="RUNNING"
        hasFailedTurn={false}
      />,
    );
    expect(screen.getByRole("button", { name: "labels.PAUSE" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "labels.RESUME" }),
    ).toBeDisabled();
    // A user-archived bot is PAUSED without an admin pause: no Resume offered.
    const { unmount } = render(
      <AdminSokoBotActions
        sokoBotId="bot_2"
        status="PAUSED"
        adminPausedAt={null}
        hasFailedTurn={false}
      />,
    );
    expect(
      screen.getAllByRole("button", { name: "labels.RESUME" }).at(-1),
    ).toBeDisabled();
    expect(
      screen.getAllByRole("button", { name: "labels.PAUSE" }).at(-1),
    ).toBeDisabled();
    unmount();
    expect(
      screen.getByRole("button", { name: "labels.RETRY_LAST_FAILED" }),
    ).toBeDisabled();
  });

  it(
    "keeps the same operationId across a failed retry and regenerates after success",
    async () => {
      performMock
        .mockResolvedValueOnce({
          ok: false,
          error: { code: "X", message: "boom" },
        })
        .mockResolvedValueOnce({ ok: true, value: {} });
      render(
        <AdminSokoBotActions
          sokoBotId="bot_1"
          status="PAUSED"
          adminPausedAt={new Date("2026-01-01T00:00:00Z")}
          hasFailedTurn
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "labels.RESUME" }));
      fireEvent.change(
        await screen.findByLabelText(
          "reasonLabel",
          {},
          { timeout: OPERATION_ASSERTION_TIMEOUT_MS },
        ),
        { target: { value: "Investigation finished" } },
      );
      const confirm = await screen.findByRole(
        "button",
        { name: "confirm" },
        { timeout: OPERATION_ASSERTION_TIMEOUT_MS },
      );
      fireEvent.click(confirm);
      await waitFor(() => expect(performMock).toHaveBeenCalledTimes(1), {
        timeout: OPERATION_ASSERTION_TIMEOUT_MS,
      });
      const first = performMock.mock.calls[0]?.[0] as {
        input: { operationId: string };
      };
      expect(first.input.operationId).toMatch(/[0-9a-f-]{36}/);

      // Retry after failure re-sends the same operation.
      fireEvent.click(
        await screen.findByRole(
          "button",
          { name: "confirm" },
          { timeout: OPERATION_ASSERTION_TIMEOUT_MS },
        ),
      );
      await waitFor(() => expect(performMock).toHaveBeenCalledTimes(2), {
        timeout: OPERATION_ASSERTION_TIMEOUT_MS,
      });
      const second = performMock.mock.calls[1]?.[0] as {
        input: { operationId: string };
      };
      expect(second.input.operationId).toBe(first.input.operationId);
      await waitFor(() => expect(refreshMock).toHaveBeenCalled(), {
        timeout: OPERATION_ASSERTION_TIMEOUT_MS,
      });

      // A new action after success gets a fresh operation id.
      fireEvent.click(
        screen.getByRole("button", { name: "labels.RESET_MEMORY" }),
      );
      fireEvent.change(
        await screen.findByLabelText(
          "reasonLabel",
          {},
          { timeout: OPERATION_ASSERTION_TIMEOUT_MS },
        ),
        { target: { value: "Corrupt notes" } },
      );
      fireEvent.click(
        await screen.findByRole(
          "button",
          { name: "confirm" },
          { timeout: OPERATION_ASSERTION_TIMEOUT_MS },
        ),
      );
      await waitFor(() => expect(performMock).toHaveBeenCalledTimes(3), {
        timeout: OPERATION_ASSERTION_TIMEOUT_MS,
      });
      const third = performMock.mock.calls[2]?.[0] as {
        input: { operationId: string; action: string };
      };
      expect(third.input.action).toBe("RESET_MEMORY");
      expect(third.input.operationId).not.toBe(first.input.operationId);
    },
    RETRY_FLOW_TEST_TIMEOUT_MS,
  );

  it("requires a reason before confirming and submits action + reason", async () => {
    performMock.mockResolvedValue({ ok: true, value: {} });
    render(
      <AdminSokoBotActions
        sokoBotId="bot_1"
        status="PAUSED"
        adminPausedAt={new Date("2026-01-01T00:00:00Z")}
        hasFailedTurn
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "labels.RESUME" }));

    const confirm = await screen.findByRole("button", { name: "confirm" });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText("reasonLabel"), {
      target: { value: "Investigation finished" },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(performMock).toHaveBeenCalledWith({
        input: expect.objectContaining({
          sokoBotId: "bot_1",
          action: "RESUME",
          reason: "Investigation finished",
          operationId: expect.stringMatching(/[0-9a-f-]{36}/),
        }),
      }),
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });
});
