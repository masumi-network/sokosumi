import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions/soko-bot/action", () => ({
  resolveSokoBotDecisionAction: (...args: unknown[]) => resolveMock(...args),
}));

import { DecisionActions } from "../decision-actions.client";

describe("DecisionActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables Accept for an unacceptable proposal but keeps Reject", async () => {
    resolveMock.mockResolvedValue({ ok: true, value: {} });
    render(<DecisionActions decisionId="d1" acceptDisabled />);
    const accept = screen.getByRole("button", { name: "accept" });
    expect(accept).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "reject" }));
    await waitFor(() =>
      expect(resolveMock).toHaveBeenCalledWith({
        decisionId: "d1",
        resolution: "REJECT",
      }),
    );
  });

  it("accepts when the proposal is acceptable", async () => {
    resolveMock.mockResolvedValue({ ok: true, value: {} });
    render(<DecisionActions decisionId="d1" />);
    fireEvent.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() =>
      expect(resolveMock).toHaveBeenCalledWith({
        decisionId: "d1",
        resolution: "ACCEPT",
      }),
    );
  });
});
