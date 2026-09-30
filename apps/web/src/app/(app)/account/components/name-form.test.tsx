import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NameForm } from "./name-form";

const updateUserMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    updateUser: (...args: unknown[]) => updateUserMock(...args),
  },
}));

function field(testId: string) {
  return screen.getByTestId(testId);
}

function submit(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: "submit" }));
}

describe("NameForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateUserMock.mockResolvedValue({ data: {}, error: null });
  });

  it("shows the current name parts and display name", () => {
    render(<NameForm name="Ada L." firstName="Ada" lastName="Lovelace" />);

    expect(field("account-first-name")).toHaveValue("Ada");
    expect(field("account-last-name")).toHaveValue("Lovelace");
    expect(field("account-display-name")).toHaveValue("Ada L.");
  });

  it("saves an edited last name and leaves the display name as typed", async () => {
    const user = userEvent.setup();
    render(<NameForm name="Ada L." firstName="Ada" lastName="Lovelace" />);

    await user.clear(field("account-last-name"));
    await user.type(field("account-last-name"), " Byron ");
    await submit(user);

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith({
        firstName: "Ada",
        lastName: "Byron",
        name: "Ada L.",
      });
    });
    expect(toast.success).toHaveBeenCalledWith("success");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("lets a user without name parts change only the display name", async () => {
    const user = userEvent.setup();
    render(<NameForm name="Ada" firstName="" lastName="" />);

    await user.type(field("account-display-name"), " Lovelace");
    await submit(user);

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith({
        firstName: null,
        lastName: null,
        name: "Ada Lovelace",
      });
    });
  });

  it("asks for the other part once one is filled", async () => {
    const user = userEvent.setup();
    render(<NameForm name="Ada" firstName="" lastName="" />);

    await user.type(field("account-first-name"), "Ada");
    await submit(user);

    expect(await screen.findByText("LastName.required")).toBeVisible();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("does not let a user who has name parts remove them", async () => {
    const user = userEvent.setup();
    render(<NameForm name="Ada L." firstName="Ada" lastName="Lovelace" />);

    await user.clear(field("account-first-name"));
    await user.clear(field("account-last-name"));
    await submit(user);

    expect(await screen.findByText("FirstName.required")).toBeVisible();
    expect(screen.getByText("LastName.required")).toBeVisible();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("reports a failed update and keeps what was typed", async () => {
    const user = userEvent.setup();
    updateUserMock.mockResolvedValue({
      data: null,
      error: { message: "Name rejected" },
    });
    render(<NameForm name="Ada L." firstName="Ada" lastName="Lovelace" />);

    await user.clear(field("account-display-name"));
    await user.type(field("account-display-name"), "Countess");
    await submit(user);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Name rejected");
    });
    expect(field("account-display-name")).toHaveValue("Countess");
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
