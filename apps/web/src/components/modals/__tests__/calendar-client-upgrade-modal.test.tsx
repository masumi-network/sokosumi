import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CalendarClientUpgradeModal } from "@/components/modals/calendar-client-upgrade-modal";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("CalendarClientUpgradeModal", () => {
  it("requires the user to reload before continuing", async () => {
    const user = userEvent.setup();
    const handleReload = vi.fn();

    render(<CalendarClientUpgradeModal open onReload={handleReload} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "reload" }));

    expect(handleReload).toHaveBeenCalledOnce();
  });
});
