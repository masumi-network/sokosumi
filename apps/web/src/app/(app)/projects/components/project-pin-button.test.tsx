import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pin: vi.fn(),
  unpin: vi.fn(),
}));

vi.mock("@/app/projects/actions", () => ({
  pinProjectAction: mocks.pin,
  unpinProjectAction: mocks.unpin,
}));

import { ProjectPinButton } from "./project-pin-button";

const labels = { pin: "Pin project", unpin: "Unpin project" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pin.mockResolvedValue({ projectId: "p1", starredAt: new Date() });
  mocks.unpin.mockResolvedValue({ projectId: "p1", starredAt: null });
});

describe("ProjectPinButton", () => {
  it("offers to Pin a project the reader has not Pinned", () => {
    render(
      <ProjectPinButton projectId="p1" isPinned={false} labels={labels} />,
    );

    const button = screen.getByRole("button", { name: "Pin project" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("offers to Unpin one they have", () => {
    render(<ProjectPinButton projectId="p1" isPinned labels={labels} />);

    const button = screen.getByRole("button", { name: "Unpin project" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("Pins on click", async () => {
    render(
      <ProjectPinButton projectId="p1" isPinned={false} labels={labels} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pin project" }));

    await waitFor(() => {
      expect(mocks.pin).toHaveBeenCalledWith({ projectId: "p1" });
    });
    expect(mocks.unpin).not.toHaveBeenCalled();
  });

  it("Unpins on click when already Pinned", async () => {
    render(<ProjectPinButton projectId="p1" isPinned labels={labels} />);
    fireEvent.click(screen.getByRole("button", { name: "Unpin project" }));

    await waitFor(() => {
      expect(mocks.unpin).toHaveBeenCalledWith({ projectId: "p1" });
    });
    expect(mocks.pin).not.toHaveBeenCalled();
  });

  it("renders without a QueryClientProvider", () => {
    // Refreshing the sidebar cache is best-effort. The button must not demand
    // a provider, or every test that renders a project row needs one.
    expect(() =>
      render(<ProjectPinButton projectId="p1" isPinned labels={labels} />),
    ).not.toThrow();
  });

  it("offers nothing on a closed project the reader has not Pinned", () => {
    // A closed project is filtered out of the Pin list, so Pinning one would
    // create a Pin that never appears anywhere.
    render(
      <ProjectPinButton
        projectId="p1"
        isPinned={false}
        isClosed
        labels={labels}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("still lets a Pin be cleared from a closed project", () => {
    // Hiding it outright would strand the Pin with no way back, which is why
    // Core's unstar route accepts a closed project too.
    render(
      <ProjectPinButton projectId="p1" isPinned isClosed labels={labels} />,
    );

    expect(screen.getByRole("button", { name: "Unpin project" })).toBeDefined();
  });

  it("marks a Pinned project apart by more than one step of grey", () => {
    // On the preview the two states were near-identical at 16px: a filled
    // lucide Pin barely differs from an outlined one, and muted-to-foreground
    // is a small step. Hue, fill and ground now move together.
    const { unmount } = render(
      <ProjectPinButton projectId="p1" isPinned labels={labels} />,
    );
    const pinnedClasses =
      screen.getByRole("button").className.split(/\s+/) ?? [];
    expect(pinnedClasses).toContain("text-primary");
    expect(pinnedClasses).toContain("bg-primary/10");
    expect(
      screen.getByRole("button").querySelector("svg")?.getAttribute("class"),
    ).toContain("fill-current");
    unmount();

    render(
      <ProjectPinButton projectId="p1" isPinned={false} labels={labels} />,
    );
    const unpinnedClasses = screen.getByRole("button").className.split(/\s+/);
    expect(unpinnedClasses).not.toContain("text-primary");
    expect(unpinnedClasses).not.toContain("bg-primary/10");
    expect(
      screen.getByRole("button").querySelector("svg")?.getAttribute("class"),
    ).not.toContain("fill-current");
  });
});
