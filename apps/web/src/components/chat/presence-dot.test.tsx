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
});
