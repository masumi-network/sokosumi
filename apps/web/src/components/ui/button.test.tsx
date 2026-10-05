import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/button";

describe("Button loading", () => {
  it("keeps the label and stays focusable while loading", () => {
    render(<Button loading>Log out</Button>);

    const button = screen.getByRole("button", { name: "Log out" });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    button.focus();
    expect(button).toHaveFocus();
  });

  it("draws the sweeping bar only while loading", () => {
    const { container, rerender } = render(<Button loading>Save</Button>);
    expect(
      container.querySelector('[data-slot="button-loading-bar"]'),
    ).not.toBeNull();

    rerender(<Button>Save</Button>);
    expect(
      container.querySelector('[data-slot="button-loading-bar"]'),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).not.toHaveAttribute(
      "aria-busy",
    );
  });

  it("ignores clicks while loading", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not submit its form while loading", () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading>
          Save
        </Button>
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("never sets native disabled and aria-disabled together", () => {
    render(
      <Button loading disabled>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).not.toHaveAttribute("disabled");
    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  it("stays natively disabled when disabled without loading", () => {
    render(<Button disabled>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps the bar on the slotted child with asChild", () => {
    render(
      <Button asChild loading>
        <a href="/export">Export</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Export" });
    expect(link).toHaveAttribute("aria-busy", "true");
    expect(
      link.querySelector('[data-slot="button-loading-bar"]'),
    ).not.toBeNull();
  });
});
