import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  wizard: vi.fn(),
  /** Renders the real wizard, and so the real Radix dialog, when true. */
  realWizard: { current: false },
}));

vi.mock("./create-project-wizard", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./create-project-wizard")>();
  return {
    CreateProjectWizard: (
      props: ComponentProps<typeof actual.CreateProjectWizard>,
    ) => {
      mocks.wizard(props);
      return mocks.realWizard.current ? (
        <actual.CreateProjectWizard {...props} />
      ) : null;
    },
  };
});
// The real wizard's server action and brand step; neither runs here.
vi.mock("@/lib/actions/project/action", () => ({ createProject: vi.fn() }));
vi.mock("@/app/projects/components/project-brand-setup", () => ({
  ProjectBrandSetup: () => null,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { InlineCreateProjectModal } from "./inline-create-project-modal";

function renderModal(
  props: Partial<Parameters<typeof InlineCreateProjectModal>[0]> = {},
) {
  render(
    <InlineCreateProjectModal
      open
      onOpenChange={vi.fn()}
      onCreated={vi.fn()}
      {...props}
    />,
  );
  return mocks.wizard.mock.lastCall?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.realWizard.current = false;
});

describe("InlineCreateProjectModal", () => {
  it("tracks a project as made from the task form by default", () => {
    expect(renderModal()).toMatchObject({ creationSource: "task_form" });
  });

  it("tracks the source a caller names", () => {
    expect(renderModal({ creationSource: "project_switcher" })).toMatchObject({
      creationSource: "project_switcher",
    });
  });

  it("hands focus back through onCloseAutoFocus when it closes", async () => {
    mocks.realWizard.current = true;
    const user = userEvent.setup();
    const onCloseAutoFocus = vi.fn();
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <InlineCreateProjectModal
          open={open}
          onOpenChange={setOpen}
          onCreated={vi.fn()}
          onCloseAutoFocus={onCloseAutoFocus}
        />
      );
    }
    render(<Host />);
    await screen.findByTestId("create-project-wizard");
    expect(onCloseAutoFocus).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(onCloseAutoFocus).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("create-project-wizard")).toBeNull();
  });
});
