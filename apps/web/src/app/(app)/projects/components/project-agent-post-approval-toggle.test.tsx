import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectAgentPostApprovalToggle } from "./project-agent-post-approval-toggle";

const { setApproval, toastError } = vi.hoisted(() => ({
  setApproval: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/actions/project/action", () => ({
  setProjectAgentPostApproval: setApproval,
}));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("ProjectAgentPostApprovalToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves the Project setting when switched on", async () => {
    setApproval.mockResolvedValue({
      ok: true,
      value: { requireAgentPostApproval: true },
    });
    render(
      <ProjectAgentPostApprovalToggle projectId="project" initial={false} />,
    );

    const toggle = screen.getByRole("switch", {
      name: "agentPostApprovalTitle",
    });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);

    expect(setApproval).toHaveBeenCalledWith({
      projectId: "project",
      requireAgentPostApproval: true,
    });
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("restores the switch and reports when saving fails", async () => {
    setApproval.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: undefined },
    });
    render(<ProjectAgentPostApprovalToggle projectId="project" initial />);

    const toggle = screen.getByRole("switch", {
      name: "agentPostApprovalTitle",
    });
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("agentPostApprovalError"),
    );
    expect(toggle).toBeChecked();
  });
});
