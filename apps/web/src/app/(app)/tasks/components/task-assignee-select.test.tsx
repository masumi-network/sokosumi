import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { encodeTaskAssigneeValue } from "@/app/tasks/utils/task-assignee";
import { mockCoworkerOption } from "@/test-fixtures/coworker";

import { TaskAssigneeSelect } from "./task-assignee-select";

const coworkerOptions = [
  mockCoworkerOption({
    id: "coworker-1",
    slug: "elena",
    name: "Elena",
  }),
];

const memberOptions = [
  { id: "user-1", name: "Ada", image: null },
  { id: "user-2", name: "Grace", image: null },
];

const labels = {
  assignee: "Assignee",
  unassigned: "Unassigned",
  me: "Me",
  people: "People",
  coworkers: "Coworkers",
  searchPlaceholder: "Search assignees...",
  emptyResults: "No assignees found.",
};

describe("TaskAssigneeSelect", () => {
  it("labels the current user as Me and keeps their name", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <TaskAssigneeSelect
        coworkerOptions={coworkerOptions}
        memberOptions={memberOptions}
        currentUserId="user-1"
        value={encodeTaskAssigneeValue({ kind: "coworker", id: "coworker-1" })}
        onChange={onChange}
        {...labels}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Assignee" }));

    expect(screen.getByRole("option", { name: /Me/ })).toHaveTextContent("Ada");

    await user.click(screen.getByRole("option", { name: /Me/ }));

    expect(onChange).toHaveBeenCalledWith(
      encodeTaskAssigneeValue({ kind: "user", id: "user-1" }),
    );
  });

  it("shows Me on the trigger when the current user is selected", () => {
    render(
      <TaskAssigneeSelect
        coworkerOptions={coworkerOptions}
        memberOptions={memberOptions}
        currentUserId="user-1"
        value={encodeTaskAssigneeValue({ kind: "user", id: "user-1" })}
        onChange={vi.fn()}
        {...labels}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Assignee" }),
    ).toHaveTextContent("Me");
    expect(
      screen.getByRole("combobox", { name: "Assignee" }),
    ).not.toHaveTextContent("Ada");
  });
});
