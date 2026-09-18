import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import type { ProjectSummary } from "@/lib/clients/generated/core/types.gen";

import { TaskMetaDetails } from "./task-meta";

vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({
    formatShortDate: () => "Mar 1",
  }),
}));

function buildMetaProps(
  overrides: Partial<{
    project: TaskWithCoworker["project"];
    assignee: TaskWithCoworker["assignee"];
    variant: "card" | "list";
  }> = {},
) {
  return {
    project: null,
    assignee: null,
    commentsCount: 0,
    createdAt: "2026-03-01T00:00:00.000Z",
    variant: "card" as const,
    ...overrides,
  };
}

const autumnProject: ProjectSummary = {
  id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  name: "Autumn",
  logo: "https://example.com/logo.png",
};

describe("TaskMetaDetails", () => {
  it("renders the project mark before the assignee on cards", () => {
    render(
      <TaskMetaDetails
        {...buildMetaProps({
          project: autumnProject,
          assignee: {
            id: "cow-1",
            name: "Soko",
            kind: "coworker",
          },
          variant: "card",
        })}
      />,
    );

    expect(screen.getByTestId("project-avatar")).toBeInTheDocument();
    expect(screen.getByLabelText("Autumn")).toBeInTheDocument();
    expect(screen.getByLabelText("Soko")).toBeInTheDocument();
    expect(screen.queryByText("Owner")).not.toBeInTheDocument();

    const projectNode = screen.getByTestId("project-avatar");
    const assigneeNode = screen.getByText("S");
    expect(projectNode.compareDocumentPosition(assigneeNode)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("omits the project slot when project is null on cards", () => {
    render(<TaskMetaDetails {...buildMetaProps({ variant: "card" })} />);

    expect(screen.queryByTestId("project-avatar")).toBeNull();
  });

  it("renders the project mark before the assignee on list rows", () => {
    const { container } = render(
      <TaskMetaDetails
        {...buildMetaProps({
          project: autumnProject,
          assignee: {
            id: "cow-1",
            name: "Soko",
            kind: "coworker",
          },
          variant: "list",
        })}
      />,
    );

    expect(screen.getByTestId("project-avatar")).toBeInTheDocument();
    expect(screen.getByText("Soko")).toBeInTheDocument();

    const projectNode = screen.getByTestId("project-avatar");
    const assigneeName = screen.getByText("Soko");
    expect(projectNode.compareDocumentPosition(assigneeName)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(container.textContent).not.toContain("Owner");
  });

  it("uses an em dash label for blank project names", () => {
    render(
      <TaskMetaDetails
        {...buildMetaProps({
          project: {
            id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
            name: "   ",
            logo: null,
          },
          variant: "card",
        })}
      />,
    );

    expect(screen.getByTestId("project-avatar")).toBeInTheDocument();
    expect(screen.getByLabelText("—")).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("—")).getByText("P"),
    ).toBeInTheDocument();
  });
});
