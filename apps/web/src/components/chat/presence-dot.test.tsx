import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChatRoomPresence } from "@/lib/clients/generated/core";

import { PresenceDot } from "./presence-dot";

function renderInRow(presence: ChatRoomPresence) {
  return render(
    <button type="button">
      Ada Lovelace
      <PresenceDot presence={presence} title="Online" />
    </button>,
  );
}

describe("PresenceDot", () => {
  it.each(["online", "afk", "offline"] as const)(
    "adds nothing to the surrounding accessible name for %s",
    (presence) => {
      renderInRow(presence);

      // The mark is decorative on every surface. Availability is stated by the
      // surface itself, because an ancestor aria-label or aria-hidden would
      // silently swallow any text rendered in here. The `title` the mark does
      // carry is a pointer affordance and must stay out of the name.
      expect(screen.getByRole("button")).toHaveAccessibleName("Ada Lovelace");
    },
  );

  it.each(["online", "afk", "offline"] as const)(
    "never labels the mark itself for %s",
    (presence) => {
      const { container } = renderInRow(presence);

      // The original defect was aria-label on a roleless <span>, where real
      // ARIA drops the name entirely. Pin the markup, because the accessible
      // name above only catches the case where the environment computes a name
      // from it: restoring aria-label here reads "Ada Lovelace online" under
      // happy-dom, but a browser would announce nothing at all.
      expect(container.querySelector("[aria-label]")).toBeNull();
      const mark = container.querySelector('[aria-hidden="true"]');
      expect(mark).not.toBeNull();
      // The title is the pointer affordance the old dot carried. It survives
      // only because the mark is aria-hidden, which keeps it out of the name
      // asserted above.
      expect(mark?.getAttribute("title")).toBe("Online");
    },
  );

  it("gives each state its own silhouette, so colour is not the only cue", () => {
    const { container: online } = render(<PresenceDot presence="online" />);
    const { container: afk } = render(<PresenceDot presence="afk" />);
    const { container: offline } = render(<PresenceDot presence="offline" />);

    const mark = (c: HTMLElement) => c.firstElementChild as HTMLElement;

    // Online is a bare filled disc, away adds the bite, offline adds the ring.
    expect(mark(online).children).toHaveLength(0);
    expect(mark(afk).children).toHaveLength(1);
    expect(mark(offline).children).toHaveLength(1);
    expect(mark(afk).className).toContain("bg-semantic-warning");
    expect(mark(offline).className).toContain("bg-background");
    expect(mark(offline).firstElementChild?.className).toContain(
      "border-presence-offline",
    );
  });

  it("clips the away bite so it cannot escape the mark", () => {
    const { container } = render(<PresenceDot presence="afk" />);
    const mark = container.firstElementChild as HTMLElement;

    // The bite is an offset, scaled copy of the disc, so it reaches past the
    // edge by design. It read as a second circle until the mark clipped it.
    expect(mark.firstElementChild?.className).toContain("translate-x-[32%]");
    expect(mark.className).toContain("overflow-hidden");
  });

  it("paints its ring and hollow fill in the ground it is told to sit on", () => {
    const { container: onSidebar } = render(
      <PresenceDot presence="offline" ground="sidebar" />,
    );
    const { container: onPopover } = render(
      <PresenceDot presence="afk" ground="popover" />,
    );

    // A ground that does not match what is behind the mark reads as a hole
    // punched in the surface, which is the whole reason the prop exists.
    const sidebarMark = onSidebar.firstElementChild as HTMLElement;
    expect(sidebarMark.className).toContain("border-sidebar");
    expect(sidebarMark.className).toContain("bg-sidebar");
    const popoverMark = onPopover.firstElementChild as HTMLElement;
    expect(popoverMark.className).toContain("border-popover");
    // The bite has to be the same colour as the ring, or the away mark stops
    // reading as a crescent and becomes a disc with a dot on it.
    expect(popoverMark.firstElementChild?.className).toContain("bg-popover");
  });
});
