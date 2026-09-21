import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pinned: vi.fn(),
  pin: vi.fn(),
  unpin: vi.fn(),
}));

vi.mock("@/hooks/use-pinned-projects", () => ({
  PINNED_PROJECTS_QUERY_KEY: "sidebar-pinned-projects",
  usePinnedProjects: () => mocks.pinned(),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    },
    isPending: false,
    isRefetching: false,
    error: null,
  }),
}));

vi.mock("@/app/projects/actions", () => ({
  pinProjectAction: mocks.pin,
  unpinProjectAction: mocks.unpin,
}));

import { ProjectDetailPinButton } from "./project-detail-pin-button";

const labels = { pin: "Pin project", unpin: "Unpin project" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProjectDetailPinButton", () => {
  it("reads Pinned from the reader's Pin list, since the project carries none", () => {
    mocks.pinned.mockReturnValue({
      data: [{ id: "p1" }, { id: "other" }],
      isError: false,
    });

    render(<ProjectDetailPinButton projectId="p1" labels={labels} />);

    expect(screen.getByRole("button", { name: "Unpin project" })).toBeDefined();
  });

  it("reads unpinned when the project is absent from that list", () => {
    mocks.pinned.mockReturnValue({ data: [{ id: "other" }], isError: false });

    render(<ProjectDetailPinButton projectId="p1" labels={labels} />);

    expect(screen.getByRole("button", { name: "Pin project" })).toBeDefined();
  });

  it("holds the space instead of guessing while the list loads", () => {
    mocks.pinned.mockReturnValue({ data: undefined, isError: false });

    render(<ProjectDetailPinButton projectId="p1" labels={labels} />);

    // Rendering an unpinned button that flips a moment later would state
    // something false about the reader's own project.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("still lets a Pin be cleared from a closed project", () => {
    // GET /starred keeps closed Pins for this surface. Hiding the control
    // would strand one with no way back — the flyout already dropped it.
    mocks.pinned.mockReturnValue({ data: [{ id: "p1" }], isError: false });

    render(<ProjectDetailPinButton projectId="p1" isClosed labels={labels} />);

    expect(screen.getByRole("button", { name: "Unpin project" })).toBeDefined();
  });

  it("offers the control rather than a blank slot when the Pin list fails", () => {
    mocks.pinned.mockReturnValue({ data: undefined, isError: true });

    render(<ProjectDetailPinButton projectId="p1" labels={labels} />);

    expect(screen.getByRole("button", { name: "Pin project" })).toBeDefined();
  });
  it("stays Pinned once the action resolves", async () => {
    mocks.pinned.mockReturnValue({ data: [], isError: false });
    render(<ProjectDetailPinButton projectId="p1" labels={labels} />);
    fireEvent.click(screen.getByRole("button", { name: "Pin project" }));
    await waitFor(() => expect(mocks.pin).toHaveBeenCalled());
    // If H1 holds this ALSO reverts here, because the mocked hook never
    // changes its answer — proving the fallback, not the surface, is at fault.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Unpin project" }),
      ).toBeDefined(),
    );
  });
});
