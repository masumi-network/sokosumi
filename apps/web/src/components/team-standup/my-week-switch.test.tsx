import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyWeekSwitch } from "./my-week-switch";

const updateUser = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: { updateUser: (body: unknown) => updateUser(body) },
}));

vi.mock("sonner", () => ({
  toast: {
    promise: (promise: Promise<unknown>) => {
      promise.catch(() => undefined);
    },
  },
}));

describe("MyWeekSwitch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateUser.mockResolvedValue({ data: {}, error: null });
  });

  it("is on for someone who never chose, and turning it off stores hide", async () => {
    render(<MyWeekSwitch included />);
    const control = screen.getByRole("switch", { name: "title" });
    expect(control).toBeChecked();

    await userEvent.click(control);

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith({ hideWeekFromStandup: true }),
    );
    expect(control).not.toBeChecked();
  });

  it("puts the switch back when the save fails", async () => {
    updateUser.mockResolvedValue({ data: null, error: { message: "nope" } });
    render(<MyWeekSwitch included={false} />);
    const control = screen.getByRole("switch", { name: "title" });

    await userEvent.click(control);

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith({ hideWeekFromStandup: false }),
    );
    await waitFor(() => expect(control).not.toBeChecked());
  });
});
