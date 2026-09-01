import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  encodeTaskAssigneeValue,
  UNSET_TASK_ASSIGNEE_VALUE,
} from "@/app/tasks/utils/task-assignee";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
  personalAssistants: "Personal assistants",
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

  it("keeps a long assignee list in a pannable overflow region", async () => {
    const user = userEvent.setup();
    const manyMembers = Array.from({ length: 20 }, (_, index) => ({
      id: `user-${index}`,
      name: `Member ${index}`,
      image: null,
    }));

    render(
      <TaskAssigneeSelect
        coworkerOptions={coworkerOptions}
        memberOptions={manyMembers}
        value={UNSET_TASK_ASSIGNEE_VALUE}
        onChange={vi.fn()}
        {...labels}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Assignee" }));

    const list = await waitFor(() => {
      const content = document.querySelector('[data-slot="popover-content"]');
      expect(content).toBeTruthy();
      const region = content?.querySelector('[data-slot="command-list"]');
      expect(region).toBeTruthy();
      return region as HTMLElement;
    });

    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toContain("overscroll-contain");
    expect(list.className).toContain("touch-pan-y");
    expect(list.className).toContain("[scrollbar-width:thin]");
  });

  it("portals the list into a dialog so wheel scroll is allowlisted", async () => {
    const user = userEvent.setup();

    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>New task</DialogTitle>
          <TaskAssigneeSelect
            coworkerOptions={coworkerOptions}
            memberOptions={memberOptions}
            value={UNSET_TASK_ASSIGNEE_VALUE}
            onChange={vi.fn()}
            {...labels}
          />
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByRole("combobox", { name: "Assignee" }));

    const dialog = await waitFor(() => {
      const content = document.querySelector('[data-slot="dialog-content"]');
      expect(content).toBeTruthy();
      return content as HTMLElement;
    });

    await waitFor(() => {
      expect(
        dialog.querySelector('[data-slot="popover-content"]'),
      ).toBeTruthy();
    });

    expect(
      document.body.querySelector(
        ':scope > [data-radix-popper-content-wrapper] [data-slot="popover-content"]',
      ),
    ).toBeNull();
  });

  it("nests personal assistants under their owner instead of Coworkers", async () => {
    const user = userEvent.setup();

    render(
      <TaskAssigneeSelect
        coworkerOptions={[
          mockCoworkerOption({
            id: "coworker-1",
            slug: "elena",
            name: "Elena",
          }),
          mockCoworkerOption({
            id: "coworker-jarvis",
            slug: "jarvis",
            name: "Jarvis",
            caption: "Alice's personal assistant",
            sokoBotId: "01960001-0001-7001-8001-000000000099",
            ownerUserId: "user-1",
          }),
        ]}
        memberOptions={memberOptions}
        currentUserId="user-1"
        value={UNSET_TASK_ASSIGNEE_VALUE}
        onChange={vi.fn()}
        {...labels}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Assignee" }));

    const peopleGroup = screen.getByText("People").closest("[cmdk-group]");
    const coworkersGroup = screen
      .getByText("Coworkers")
      .closest("[cmdk-group]");
    expect(peopleGroup).toBeTruthy();
    expect(coworkersGroup).toBeTruthy();

    expect(peopleGroup).toHaveTextContent("Jarvis");
    expect(coworkersGroup).not.toHaveTextContent("Jarvis");
    expect(coworkersGroup).toHaveTextContent("Elena");

    const jarvis = screen.getByRole("option", { name: /Jarvis/ });
    expect(jarvis.className).toContain("pl-10");
    expect(jarvis).toHaveTextContent("Jarvis");
    expect(jarvis).not.toHaveTextContent("Alice's personal assistant");
  });

  it("lists personal assistants whose owner is missing in their own category", async () => {
    const user = userEvent.setup();

    render(
      <TaskAssigneeSelect
        coworkerOptions={[
          mockCoworkerOption({
            id: "coworker-alfred",
            slug: "alfred",
            name: "Alfred",
            sokoBotId: "01960001-0001-7001-8001-000000000098",
            ownerUserId: "user-gone",
          }),
        ]}
        memberOptions={memberOptions}
        value={UNSET_TASK_ASSIGNEE_VALUE}
        onChange={vi.fn()}
        {...labels}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Assignee" }));

    const assistantsGroup = screen
      .getByText("Personal assistants")
      .closest("[cmdk-group]");
    expect(assistantsGroup).toBeTruthy();
    expect(assistantsGroup).toHaveTextContent("Alfred");
    expect(screen.queryByText("Coworkers")).toBeNull();
  });
});
