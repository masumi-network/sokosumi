import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryProvider } from "@/test/query-provider";

const { listMock, createMock, toastErrorMock, toastSuccessMock } = vi.hoisted(
  () => ({
    listMock: vi.fn(),
    createMock: vi.fn(),
    toastErrorMock: vi.fn(),
    toastSuccessMock: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

vi.mock("@/lib/actions/admin-matched-channels/action", () => ({
  listAdminMatchedChannelsAction: (...args: unknown[]) => listMock(...args),
  createAdminMatchedChannelAction: (...args: unknown[]) => createMock(...args),
}));

import { MatchedChannelsHub } from "./matched-channels-hub";

describe("MatchedChannelsHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only toasts errors for the current status tab", async () => {
    const user = userEvent.setup();
    let finishActive: (value: unknown) => void = () => {};
    listMock
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishActive = resolve)),
      )
      .mockResolvedValueOnce({ ok: true, value: [] });

    render(<MatchedChannelsHub />, { wrapper: TestQueryProvider });

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("tab", { name: "List.tabArchived" }));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("List.emptyArchived")).toBeInTheDocument();

    await act(async () => {
      finishActive({ ok: false, error: { message: "active load failed" } });
    });

    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
