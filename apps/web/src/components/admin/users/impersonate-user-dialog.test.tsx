import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImpersonateUserDialog } from "@/components/admin/users/impersonate-user-dialog";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    if (key === "description" && values) {
      return `description:${values.name}:${values.email}`;
    }
    return key;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const startImpersonationMock = vi.fn();

vi.mock("@/lib/api/admin-impersonation", () => ({
  startImpersonation: (...args: unknown[]) => startImpersonationMock(...args),
}));

const assignMock = vi.fn();

describe("ImpersonateUserDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("location", { assign: assignMock });
    startImpersonationMock.mockResolvedValue({
      ok: true,
      value: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderDialog() {
    render(
      <ImpersonateUserDialog
        userId="user-1"
        name="Ada Lovelace"
        email="ada@example.com"
      />,
    );
  }

  it("opens a confirm dialog naming the target user", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "trigger" }));

    expect(
      await screen.findByText("description:Ada Lovelace:ada@example.com"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("reasonLabel")).toBeInTheDocument();
  });

  it("keeps start disabled until a reason is entered", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "trigger" }));
    const startButton = await screen.findByRole("button", { name: "start" });

    expect(startButton).toBeDisabled();

    await user.type(screen.getByLabelText("reasonLabel"), "   ");
    expect(startButton).toBeDisabled();

    await user.clear(screen.getByLabelText("reasonLabel"));
    await user.type(screen.getByLabelText("reasonLabel"), "SOK-1: x");
    expect(startButton).toBeEnabled();
  });

  it("starts the impersonation and reloads at home on success", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "trigger" }));
    await user.type(
      screen.getByLabelText("reasonLabel"),
      "  SOK-1080: reproduce  ",
    );
    await user.click(await screen.findByRole("button", { name: "start" }));

    expect(startImpersonationMock).toHaveBeenCalledWith({
      userId: "user-1",
      reason: "SOK-1080: reproduce",
    });
    expect(assignMock).toHaveBeenCalledWith("/");
  });

  it("toasts Core errors and stays open without navigating", async () => {
    const { toast } = await import("sonner");
    startImpersonationMock.mockResolvedValue({
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Admin users cannot be impersonated",
      },
    });
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "trigger" }));
    await user.type(screen.getByLabelText("reasonLabel"), "SOK-1: x");
    await user.click(await screen.findByRole("button", { name: "start" }));

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "Admin users cannot be impersonated",
    );
    expect(assignMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("reasonLabel")).toBeInTheDocument();
  });
});
