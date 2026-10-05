import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/../messages/en.json";
import { Button } from "@/components/ui/button";
import {
  ButtonLoadingAnnouncer,
  ButtonLoadingBar,
} from "@/components/ui/button-loading-bar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

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

  it("keeps a loading click from reaching a clickable parent", () => {
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <Button loading>Save</Button>
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onParentClick).not.toHaveBeenCalled();
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

describe("Button loading announcement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderAnnounced(ui: React.ReactNode) {
    const wrap = (node: React.ReactNode) => (
      <NextIntlClientProvider locale="en" messages={messages}>
        <ButtonLoadingAnnouncer>{node}</ButtonLoadingAnnouncer>
      </NextIntlClientProvider>
    );
    const view = render(wrap(ui));
    return {
      region: screen.getByRole("status"),
      rerender: (next: React.ReactNode) => view.rerender(wrap(next)),
    };
  }

  function flush() {
    act(() => {
      vi.advanceTimersByTime(100);
    });
  }

  it("politely announces the label once when loading starts", () => {
    const { region, rerender } = renderAnnounced(<Button>Save</Button>);
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();

    rerender(<Button loading>Save</Button>);
    flush();

    expect(region).toHaveTextContent(/^Save, in progress$/);
    // The region sits outside the button, so the button keeps its name.
    expect(screen.getByRole("button", { name: "Save" })).not.toContainElement(
      region,
    );
  });

  it("names an icon-only button by its aria-label", () => {
    const { region } = renderAnnounced(
      <Button loading size="icon" aria-label="Refresh">
        <svg />
      </Button>,
    );
    flush();

    expect(region).toHaveTextContent(/^Refresh, in progress$/);
  });

  it("leaves aria-hidden decoration out of the label", () => {
    const { region } = renderAnnounced(
      <Button loading>
        Inbox <span aria-hidden="true">12</span>
      </Button>,
    );
    flush();

    expect(region).toHaveTextContent(/^Inbox, in progress$/);
  });

  it("uses the given label for a bar drawn outside a Button", () => {
    const { region } = renderAnnounced(
      <div className="relative">
        <button type="button">Google</button>
        <ButtonLoadingBar label="Continue with Google" />
      </div>,
    );
    flush();

    expect(region).toHaveTextContent(/^Continue with Google, in progress$/);
  });

  it("announces the same button again on its next run", () => {
    const { region, rerender } = renderAnnounced(<Button loading>Save</Button>);
    flush();
    rerender(<Button>Save</Button>);

    rerender(<Button loading>Save</Button>);
    // Emptied first, so screen readers see a change even for the same text.
    expect(region).toBeEmptyDOMElement();
    flush();
    expect(region).toHaveTextContent(/^Save, in progress$/);
  });

  it("clears the announcement once loading ends", () => {
    const { region, rerender } = renderAnnounced(<Button loading>Save</Button>);
    flush();
    expect(region).toHaveTextContent(/^Save, in progress$/);

    rerender(<Button>Save</Button>);

    expect(region).toBeEmptyDOMElement();
  });

  it("keeps a newer button's announcement when an older one ends", () => {
    const { region, rerender } = renderAnnounced(
      <>
        <Button loading>Save</Button>
        <Button>Publish</Button>
      </>,
    );
    flush();
    rerender(
      <>
        <Button loading>Save</Button>
        <Button loading>Publish</Button>
      </>,
    );
    flush();

    rerender(
      <>
        <Button>Save</Button>
        <Button loading>Publish</Button>
      </>,
    );

    expect(region).toHaveTextContent(/^Publish, in progress$/);
  });

  it("stays silent when loading ends before the announcement", () => {
    const { region, rerender } = renderAnnounced(<Button loading>Save</Button>);
    rerender(<Button>Save</Button>);
    flush();

    expect(region).toBeEmptyDOMElement();
  });

  it("stays audible while a modal dialog hides the page behind it", () => {
    const { region } = renderAnnounced(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Delete project</DialogTitle>
          <Button loading>Delete</Button>
        </DialogContent>
      </Dialog>,
    );
    flush();

    expect(region.closest("[aria-hidden='true']")).toBeNull();
    expect(region).toHaveTextContent(/^Delete, in progress$/);
  });
});
