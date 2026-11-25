import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SidebarWorkspaceRow } from "./sidebar-workspace-row";

it("spans both sidebar columns and hides when the panel is collapsed", () => {
  render(
    <SidebarWorkspaceRow>
      <button type="button">Workspace</button>
    </SidebarWorkspaceRow>,
  );
  expect(screen.getByRole("button").parentElement).toHaveClass(
    "w-[calc(var(--app-rail-width)+var(--sidebar-width))]",
    "top-16",
    "md:sidebar-hidden:hidden",
  );
});
