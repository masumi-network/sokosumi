import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProjectDetailActions } from "@/app/projects/components/project-detail-actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/actions/project/action", () => ({
  deleteProject: vi.fn(),
}));

const LABELS = {
  moreActions: "More actions",
  edit: "Edit",
  delete: "Delete",
  deleteDialog: {
    title: "Delete project?",
    description: "This cannot be undone.",
    confirm: "Delete",
    cancel: "Cancel",
    error: "Failed to delete",
  },
};

describe("ProjectDetailActions", () => {
  it("exposes Edit and Delete only inside the overflow menu", async () => {
    const user = userEvent.setup();

    render(<ProjectDetailActions projectId="project-1" labels={LABELS} />);

    expect(
      screen.queryByRole("link", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More actions" }));

    const editLink = screen.getByRole("menuitem", { name: "Edit" });
    expect(editLink).toHaveAttribute("href", "/projects/project-1/edit");
    expect(
      screen.getByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
  });
});
