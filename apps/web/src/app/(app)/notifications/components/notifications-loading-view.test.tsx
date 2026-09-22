import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  NotificationsListSkeleton,
  NotificationsPageSkeleton,
} from "./notifications-loading-view";

describe("NotificationsPageSkeleton", () => {
  it("renders list skeleton region", () => {
    render(<NotificationsPageSkeleton />);

    expect(screen.getByTestId("notifications-loading")).toBeTruthy();
    expect(screen.getByTestId("notifications-loading-list")).toBeTruthy();
  });

  it("renders multiple skeleton bones", () => {
    const { container } = render(<NotificationsPageSkeleton />);
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThanOrEqual(8);
  });

  // The live page grows a heading above the card. Bones for it keep the
  // card in the same place across the swap.
  it("carries bones for the page heading above the card", () => {
    const { container } = render(<NotificationsPageSkeleton />);
    const card = container.querySelector(
      '[data-testid="notifications-loading"] > .rounded-xl',
    );
    const all = container.querySelectorAll('[data-slot="skeleton"]').length;
    const inCard = card?.querySelectorAll('[data-slot="skeleton"]').length ?? 0;

    expect(card).not.toBeNull();
    expect(all - inCard).toBe(2);
  });
});

describe("NotificationsListSkeleton", () => {
  it("renders shared list bones", () => {
    const { container } = render(<NotificationsListSkeleton />);

    const list = screen.getByTestId("notifications-loading-list");
    const rows = Array.from(list.children);

    // One bone per thing a real row draws: the disc, the message and the
    // time. A count on the whole card would pass with the bones in the
    // wrong rows.
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(row.querySelectorAll('[data-slot="skeleton"]').length).toBe(3);
    }
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(
      18,
    );
  });

  // The bones stand in for real rows, so they carry the row's geometry: one
  // disc per row beside its two text lines. Without the disc the message
  // slides sideways the moment the live rows arrive.
  it("gives every row bone the row's icon disc", () => {
    render(<NotificationsListSkeleton />);
    const rows = Array.from(
      screen.getByTestId("notifications-loading-list").children,
    );

    // The disc is the first bone inside the row's padded box, which is
    // where the real row draws it. Its position is the thing that keeps
    // the message from sliding when the live rows land.
    for (const row of rows) {
      const paddedBox = row.children[1];
      expect(paddedBox?.firstElementChild?.getAttribute("data-slot")).toBe(
        "skeleton",
      );
    }
  });

  // The live card grows a view strip the moment the list mounts. Without
  // bones for it, every row below steps down by the strip's height.
  it("keeps the view strip above the rows", () => {
    render(<NotificationsListSkeleton />);
    const list = screen.getByTestId("notifications-loading-list");
    const strip = list.previousElementSibling;

    expect(strip).not.toBeNull();
    expect(strip?.querySelectorAll('[data-slot="skeleton"]').length).toBe(3);
  });
});
