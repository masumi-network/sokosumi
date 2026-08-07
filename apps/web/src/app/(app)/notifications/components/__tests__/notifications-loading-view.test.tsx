import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  NotificationsListSkeleton,
  NotificationsPageSkeleton,
} from "../notifications-loading-view";

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
});

describe("NotificationsListSkeleton", () => {
  it("renders shared list bones", () => {
    const { container } = render(<NotificationsListSkeleton />);

    expect(screen.getByTestId("notifications-loading-list")).toBeTruthy();
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBe(10);
  });
});
