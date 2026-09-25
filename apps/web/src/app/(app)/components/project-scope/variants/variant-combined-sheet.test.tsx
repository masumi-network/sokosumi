import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("./variant-combined-parts", () => ({
  useCombinedScope: () => ({
    projectId: null,
    name: "All projects",
    mark: null,
    select: vi.fn(),
    openCreate: vi.fn(),
    createDialog: null,
  }),
  useCombinedWorkspaces: () => ({
    active: { id: "org-1", name: "Acme", organization: null },
  }),
  WorkspaceList: () => <p>workspace list</p>,
  WorkspaceMark: () => null,
}));
vi.mock("@/app/components/project-scope/project-scope-menu", () => ({
  ProjectScopeMenu: () => <p>project menu</p>,
}));

import {
  CombinedMobileChip,
  setCombinedSheetOpen,
  useCombinedSheetOpen,
} from "./variant-combined-sheet";

afterEach(() => {
  // The flag is module state, so it outlives each test's render.
  act(() => setCombinedSheetOpen(false));
});

function chip() {
  return screen.getByTestId("project-scope-combined-chip");
}

describe("combined sheet store", () => {
  it("tells every reader when the sheet opens and closes", () => {
    const first = renderHook(() => useCombinedSheetOpen());
    const second = renderHook(() => useCombinedSheetOpen());
    expect(first.result.current).toBe(false);

    act(() => setCombinedSheetOpen(true));
    expect(first.result.current).toBe(true);
    expect(second.result.current).toBe(true);

    act(() => setCombinedSheetOpen(false));
    expect(first.result.current).toBe(false);
    expect(second.result.current).toBe(false);
  });
});

describe("CombinedMobileChip", () => {
  it("is the sheet's trigger and takes focus back on Escape", async () => {
    const user = userEvent.setup();
    render(<CombinedMobileChip />);

    await user.click(chip());
    const sheet = await screen.findByRole("dialog");
    // Create project finds its opener through this link.
    expect(chip()).toHaveAttribute("aria-controls", sheet.id);
    expect(chip()).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(chip()).toHaveFocus());
  });

  it("takes focus when an opener outside it has gone", async () => {
    const user = userEvent.setup();
    // The null slot keeps the chip mounted when the opener goes.
    const page = (withOpener: boolean) => (
      <>
        {withOpener ? <button type="button">sidebar opener</button> : null}
        <CombinedMobileChip />
      </>
    );
    const { rerender } = render(page(true));
    screen.getByRole("button", { name: "sidebar opener" }).focus();

    // As the sidebar button does: open the flag, then unmount with the sidebar.
    act(() => setCombinedSheetOpen(true));
    rerender(page(false));
    await screen.findByRole("dialog");
    expect(
      screen.queryByRole("button", { name: "sidebar opener" }),
    ).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(chip()).toHaveFocus());
  });

  it("starts at the project list on every open", async () => {
    const user = userEvent.setup();
    render(<CombinedMobileChip />);

    await user.click(chip());
    await user.click(
      await screen.findByTestId("project-scope-combined-workspace-row"),
    );
    expect(screen.getByText("workspace list")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(chip());

    expect(await screen.findByText("project menu")).toBeInTheDocument();
    expect(screen.queryByText("workspace list")).not.toBeInTheDocument();
  });
});
