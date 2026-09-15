import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImpersonationBannerExit } from "./impersonation-banner-exit.client";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const stopImpersonationActionMock = vi.fn();

vi.mock("@/lib/actions/admin-impersonation/action", () => ({
  stopImpersonationAction: (...args: unknown[]) =>
    stopImpersonationActionMock(...args),
}));

const reloadMock = vi.fn();

describe("ImpersonationBannerExit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("location", { reload: reloadMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderExit() {
    render(<ImpersonationBannerExit label="Exit" errorMessage="stopError" />);
  }

  it("stops the impersonation and reloads on exit", async () => {
    stopImpersonationActionMock.mockResolvedValue({
      ok: true,
      value: { id: "user_admin", name: "A", email: "a@example.com" },
    });
    const user = userEvent.setup();
    renderExit();

    await user.click(screen.getByRole("button", { name: "Exit" }));

    expect(stopImpersonationActionMock).toHaveBeenCalledWith({});
    expect(reloadMock).toHaveBeenCalled();
  });

  it("toasts Core errors without reloading", async () => {
    const { toast } = await import("sonner");
    stopImpersonationActionMock.mockResolvedValue({
      ok: false,
      error: { code: "BAD_INPUT", message: "Not currently impersonating" },
    });
    const user = userEvent.setup();
    renderExit();

    await user.click(screen.getByRole("button", { name: "Exit" }));

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "Not currently impersonating",
    );
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
