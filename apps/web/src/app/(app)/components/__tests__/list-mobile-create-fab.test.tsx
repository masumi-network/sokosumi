import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ListMobileCreateFab } from "../list-mobile-create-fab";

vi.mock("@/hooks/use-is-apple-platform", () => ({
  default: () => false,
}));

describe("ListMobileCreateFab", () => {
  it("renders a single create button with aria-label and md:hidden shell", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <ListMobileCreateFab ariaLabel="Create task" onOpen={onOpen} />,
    );

    const button = screen.getByRole("button", { name: "Create task" });
    expect(button).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);

    const shell = container.querySelector("[data-list-mobile-create-fab]");
    expect(shell?.className).toContain("md:hidden");
    expect(shell?.className).toContain(
      "bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)]",
    );
  });

  it("calls onOpen once when clicked", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ListMobileCreateFab ariaLabel="Create project" onOpen={onOpen} />);

    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
