import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssigneePeopleLock } from "@/app/tasks/utils/task-property-options";
import type { CoworkerOption } from "@/lib/types/coworker";

import { TaskMetadataAssigneeField } from "./task-metadata-assignee-field";

const setTaskAssigneeMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/task/property-action", () => ({
  setTaskAssignee: setTaskAssigneeMock,
}));

vi.mock("sonner", () => ({ toast: { error: toastErrorMock } }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/aurora-orb", () => ({
  AssistantOrb: () => <div data-testid="assistant-orb" />,
}));

const vendor = {
  id: "v",
  name: "V",
  slug: "v",
  logos: { light: null, dark: null },
};

const OPTIONS: CoworkerOption[] = [
  {
    id: "bot_1",
    slug: "soko-bots",
    name: "Soko",
    image: "",
    kind: "sokoBot",
    vendor,
  },
  { id: "user_1", slug: "ada", name: "Ada", image: "", kind: "user", vendor },
  {
    id: "cw_1",
    slug: "hepha",
    name: "Hepha",
    image: "",
    kind: "coworker",
    vendor,
  },
];

let showSaved: (assigneeId: string) => void = () => {};

function renderField(
  assigneeId = "cw_1",
  peopleLock: AssigneePeopleLock = null,
) {
  const field = (id: string) => (
    <TaskMetadataAssigneeField
      taskId="task-1"
      assigneeId={id}
      options={OPTIONS}
      peopleLock={peopleLock}
      labels={{ assignee: "Assignee", noAssignee: "Unassigned" }}
    />
  );
  const view = render(field(assigneeId));
  showSaved = (id) => view.rerender(field(id));
  return view;
}

/** Saves like the real action: revalidation sends the saved value back. */
function saveLikeServer() {
  setTaskAssigneeMock.mockImplementation(
    async (input: Record<string, string | null>) => {
      showSaved(
        input.assigneeUserId ??
          input.assigneeSokoBotId ??
          input.assigneeId ??
          "",
      );
      return { ok: true, value: {} };
    },
  );
}

async function open(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name }));
  return user;
}

describe("TaskMetadataAssigneeField", () => {
  beforeEach(() => {
    setTaskAssigneeMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("sends each pick in the field Core expects for its kind", async () => {
    saveLikeServer();
    renderField();

    let user = await open("Assignee: Hepha");
    await user.click(screen.getByRole("option", { name: "Ada" }));
    expect(setTaskAssigneeMock).toHaveBeenLastCalledWith({
      taskId: "task-1",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: "user_1",
    });

    user = await open("Assignee: Ada");
    await user.click(screen.getByRole("option", { name: "Soko" }));
    expect(setTaskAssigneeMock).toHaveBeenLastCalledWith({
      taskId: "task-1",
      assigneeId: null,
      assigneeSokoBotId: "bot_1",
      assigneeUserId: null,
    });

    user = await open("Assignee: Soko");
    await user.click(screen.getByRole("option", { name: "Hepha" }));
    expect(setTaskAssigneeMock).toHaveBeenLastCalledWith({
      taskId: "task-1",
      assigneeId: "cw_1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
    });

    user = await open("Assignee: Hepha");
    await user.click(screen.getByRole("option", { name: "Unassigned" }));
    expect(setTaskAssigneeMock).toHaveBeenLastCalledWith({
      taskId: "task-1",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
    });
  });

  it("keeps people and Unassigned out of reach where Core needs an agent", async () => {
    renderField("cw_1", "agentRequired");
    await open("Assignee: Hepha");

    expect(screen.getByRole("option", { name: "Ada" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("option", { name: "Unassigned" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("option", { name: "Soko" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByText("agentRequiredHint")).toBeVisible();
  });

  it("lets a private Task drop its assignee but not go to a person", async () => {
    renderField("cw_1", "private");
    await open("Assignee: Hepha");

    expect(screen.getByRole("option", { name: "Ada" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      screen.getByRole("option", { name: "Unassigned" }),
    ).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("privateHint")).toBeVisible();
  });

  it("follows a new server value without a remount", () => {
    const { rerender } = renderField();
    const trigger = screen.getByRole("combobox", { name: "Assignee: Hepha" });

    rerender(
      <TaskMetadataAssigneeField
        taskId="task-1"
        assigneeId="user_1"
        options={OPTIONS}
        peopleLock={null}
        labels={{ assignee: "Assignee", noAssignee: "Unassigned" }}
      />,
    );

    expect(trigger).toHaveAccessibleName("Assignee: Ada");
  });

  it("will not open a second pick while the first one saves", async () => {
    let finish: (value: unknown) => void = () => {};
    setTaskAssigneeMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderField();

    const user = await open("Assignee: Hepha");
    await user.click(screen.getByRole("option", { name: "Ada" }));
    const trigger = screen.getByRole("combobox", { name: "Assignee: Ada" });
    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    // React holds every async action in one scope; end this one.
    await act(async () => finish({ ok: true, value: {} }));
  });

  it("rolls back and reports when Core refuses", async () => {
    setTaskAssigneeMock.mockResolvedValue({ ok: false, error: { kind: "x" } });
    renderField();

    const user = await open("Assignee: Hepha");
    await user.click(screen.getByRole("option", { name: "Ada" }));

    expect(
      await screen.findByRole("combobox", { name: "Assignee: Hepha" }),
    ).not.toHaveAttribute("aria-disabled");
    expect(toastErrorMock).toHaveBeenCalledWith("updateError");
  });
});
