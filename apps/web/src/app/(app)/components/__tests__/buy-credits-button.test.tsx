import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BuyCreditsButton from "@/app/components/buy-credits-button";

const pushMock = vi.fn();
const toggleSidebarMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({
    isMobile: false,
    toggleSidebar: toggleSidebarMock,
  }),
}));

describe("BuyCreditsButton", () => {
  beforeEach(() => {
    pushMock.mockReset();
    toggleSidebarMock.mockReset();
  });

  it("renders the right-side icon and navigates on click", async () => {
    const user = userEvent.setup();

    render(
      <BuyCreditsButton
        label="Get more credits"
        path="/billing?tab=subscription"
        iconRight={<svg data-testid="arrow-icon" aria-hidden="true" />}
      />,
    );

    const button = screen.getByRole("button", { name: "Get more credits" });

    expect(screen.getByTestId("arrow-icon")).toBeInTheDocument();

    await user.click(button);

    expect(pushMock).toHaveBeenCalledWith("/billing?tab=subscription");
    expect(toggleSidebarMock).not.toHaveBeenCalled();
  });
});
