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
    participants: TaskWithCoworker["participants"];
    variant: "card" | "list";
  }> = {},
) {
  return {
    project: null,
    assignee: null,
    participants: [],
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

function participant(id: string, name: string) {
  return { id, name, image: null, kind: "user" as const };
}

const ada = participant("user-ada", "Ada");
const bea = participant("user-bea", "Bea");
const cy = participant("user-cy", "Cy");
const dee = participant("user-dee", "Dee");

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
    expect(screen.getByLabelText("Soko")).toBeInTheDocument();

    const projectNode = screen.getByTestId("project-avatar");
    const assigneeName = screen.getByLabelText("Soko");
    expect(projectNode.compareDocumentPosition(assigneeName)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(container.textContent).not.toContain("Owner");
  });

  it("shows a question-mark avatar and em dash label when unassigned on cards", () => {
    render(
      <TaskMetaDetails
        {...buildMetaProps({
          assignee: null,
          variant: "card",
        })}
      />,
    );

    expect(screen.getByText("?")).toBeInTheDocument();
    expect(screen.getByLabelText("—")).toBeInTheDocument();
  });

  it("shows a question-mark avatar and em dash label when unassigned on list rows", () => {
    render(
      <TaskMetaDetails
        {...buildMetaProps({
          assignee: null,
          variant: "list",
        })}
      />,
    );

    expect(screen.getByText("?")).toBeInTheDocument();
    expect(screen.getByLabelText("—")).toBeInTheDocument();
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
    const projectLabel = screen
      .getAllByLabelText("—")
      .find((element) => within(element).queryByTestId("project-avatar"));
    expect(projectLabel).toBeDefined();
    expect(within(projectLabel!).getByText("P")).toBeInTheDocument();
  });

  describe.each(["card", "list"] as const)("actor cluster on %s", (variant) => {
    it("shows three faces and a remainder of 2 for an assignee plus four participants", () => {
      render(
        <TaskMetaDetails
          {...buildMetaProps({
            assignee: { id: "cow-1", name: "Soko", kind: "coworker" },
            participants: [ada, bea, cy, dee],
            variant,
          })}
        />,
      );

      expect(screen.getAllByTestId("task-actor-face")).toHaveLength(3);
      expect(screen.getByText("+2")).toBeInTheDocument();
      expect(
        screen.getByRole("img", { name: "Soko, Ada, Bea, Cy, Dee" }),
      ).toBeInTheDocument();
    });

    it("omits the remainder for three or fewer faces", () => {
      render(
        <TaskMetaDetails
          {...buildMetaProps({
            assignee: { id: "cow-1", name: "Soko", kind: "coworker" },
            participants: [ada, bea],
            variant,
          })}
        />,
      );

      expect(screen.getAllByTestId("task-actor-face")).toHaveLength(3);
      expect(screen.queryByText(/^\+/)).toBeNull();
    });

    it("leads with the assignee and collapses a mentioned human assignee to one face", () => {
      render(
        <TaskMetaDetails
          {...buildMetaProps({
            assignee: { id: bea.id, name: "Bea", kind: "user" },
            participants: [ada, bea],
            variant,
          })}
        />,
      );

      expect(screen.getAllByTestId("task-actor-face")).toHaveLength(2);
      expect(screen.getByRole("img", { name: "Bea, Ada" })).toBeInTheDocument();
    });

    it("shows only mentioned faces when unassigned", () => {
      render(
        <TaskMetaDetails
          {...buildMetaProps({ participants: [ada], variant })}
        />,
      );

      expect(screen.getAllByTestId("task-actor-face")).toHaveLength(1);
      expect(screen.queryByText("?")).toBeNull();
      expect(screen.getByRole("img", { name: "Ada" })).toBeInTheDocument();
    });
  });
});
