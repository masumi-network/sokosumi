import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { OrganizationSeatContext } from "@/contexts/organization-seat-context";
import { NewTaskButton } from "./new-task-button.client";

const { openNewTaskWizardMock } = vi.hoisted(() => ({
  openNewTaskWizardMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/app/components/new-task-wizard-provider", () => ({
  useOptionalNewTaskWizard: () => ({
    openNewTaskWizard: openNewTaskWizardMock,
  }),
}));

vi.mock("@/app/components/project-scope/use-project-scope", () => ({
  useProjectScope: () => ({ projectId: "project-1" }),
}));

beforeEach(() => {
  openNewTaskWizardMock.mockClear();
});

it("opens the wizard in the current project for a seated member", async () => {
  const user = userEvent.setup();
  render(
    <OrganizationSeatContext value={true}>
      <NewTaskButton />
    </OrganizationSeatContext>,
  );

  await user.click(screen.getByRole("button", { name: "newTask" }));

  expect(openNewTaskWizardMock).toHaveBeenCalledWith({
    projectId: "project-1",
  });
});

it("renders nothing for a member without a seat", () => {
  render(
    <OrganizationSeatContext value={false}>
      <NewTaskButton />
    </OrganizationSeatContext>,
  );

  expect(screen.queryByRole("button", { name: "newTask" })).toBeNull();
});
