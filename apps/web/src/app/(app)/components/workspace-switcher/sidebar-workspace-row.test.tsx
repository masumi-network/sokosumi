import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { SidebarWorkspaceRow } from "./sidebar-workspace-row";

it("keeps compact desktop actions beside the switcher at the top of both sidebar columns", () => {
  const { container } = render(
    <SidebarWorkspaceRow
      actions={
        <>
          <button type="button">Search</button>
          <button type="button">New task</button>
        </>
      }
    >
      <button type="button">Workspace</button>
    </SidebarWorkspaceRow>,
  );
  const row = container.querySelector(
    '[data-slot="sidebar-workspace-row"]',
  ) as HTMLElement;
  expect(row).toHaveClass(
    "w-[calc(var(--app-rail-width)+var(--sidebar-width))]",
    "top-0",
    "h-16",
    "md:sidebar-hidden:hidden",
  );
  expect(within(row).getAllByRole("button")).toEqual([
    screen.getByRole("button", { name: "Workspace" }),
    screen.getByRole("button", { name: "Search" }),
    screen.getByRole("button", { name: "New task" }),
  ]);
});
