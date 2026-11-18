import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
}));

import { startNavigation } from "@/test/pending-navigation";
import {
  NavigationProgress,
  useNavPathname,
} from "./navigation-progress.client";

function NavPathname() {
  return <output>{useNavPathname()}</output>;
}

function bar() {
  return document.querySelector('[data-slot="navigation-progress"]');
}

describe("NavigationProgress", () => {
  beforeEach(() => {
    render(
      <NavigationProgress>
        <NavPathname />
      </NavigationProgress>,
    );
  });

  it("shows the bar and the destination from the click until the page arrives", async () => {
    expect(bar()).toHaveAttribute("data-pending", "false");

    const arrive = await startNavigation("/calendar?view=week");
    try {
      expect(bar()).toHaveAttribute("data-pending", "true");
      expect(screen.getByRole("status")).toHaveTextContent("/calendar");
      expect(screen.getByRole("status")).not.toHaveTextContent("view=week");
    } finally {
      await arrive();
    }

    expect(bar()).toHaveAttribute("data-pending", "false");
    expect(screen.getByRole("status")).toHaveTextContent("/tasks");
  });

  it("stays quiet for a search-param change on the same page", async () => {
    const arrive = await startNavigation("/tasks?view=board");
    try {
      expect(bar()).toHaveAttribute("data-pending", "false");
    } finally {
      await arrive();
    }
  });

  // On back and forward the browser moves the address before Next starts.
  it("shows the bar when the address bar already names the destination", async () => {
    window.history.replaceState(null, "", "/calendar");
    const arrive = await startNavigation(window.location.href);
    try {
      expect(bar()).toHaveAttribute("data-pending", "true");
      expect(screen.getByRole("status")).toHaveTextContent("/calendar");
    } finally {
      await arrive();
      window.history.replaceState(null, "", "/");
    }
  });
});
