import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ wizard: vi.fn() }));

vi.mock("./create-project-wizard", () => ({
  CreateProjectWizard: (props: { creationSource?: string }) => {
    mocks.wizard(props);
    return null;
  },
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
});
