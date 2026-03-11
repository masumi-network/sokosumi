import "@testing-library/jest-dom";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import BuyCreditsButton from "@/app/components/buy-credits-button";

const pushMock = jest.fn();
const toggleSidebarMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

jest.mock("@/components/ui/sidebar", () => ({
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
