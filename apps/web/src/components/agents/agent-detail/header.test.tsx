import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OrganizationSeatContext } from "@/contexts/organization-seat-context";
import { createMockCoreAgent } from "@/lib/helpers/__tests__/fixtures/core-agent";

import { AgentDetailHeader } from "./header";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const { openNewTaskWizardMock } = vi.hoisted(() => ({
  openNewTaskWizardMock: vi.fn(),
}));

vi.mock("@/app/components/new-task-wizard-provider", () => ({
  useOptionalNewTaskWizard: () => ({
    openNewTaskWizard: openNewTaskWizardMock,
  }),
}));

vi.mock("@/app/components/project-scope/use-project-scope", () => ({
  useProjectScope: () => ({ projectId: null }),
}));

vi.mock("next/image", () => ({
  default: () => null,
}));

vi.mock("@/components/agents/agent-action-buttons", () => ({
  AgentActionButtons: () => null,
  AgentActionButtonsSkeleton: () => null,
}));

vi.mock("@/components/agents/agent-icon", () => ({
  AgentIcon: () => null,
}));

vi.mock("@/components/agents/agent-verified-badge", () => ({
  AgentVerifiedBadge: () => null,
}));

describe("AgentDetailHeader", () => {
  const agent = createMockCoreAgent({ id: "agent-1" });

  it("links to the viewer's jobs with this agent and shows how many", () => {
    render(<AgentDetailHeader agent={agent} myJobsCount={3} />);

    const link = screen.getByRole("link", { name: /yourJobs/ });
    expect(link).toHaveAttribute("href", "/agents/agent-1/jobs");
    expect(link).toHaveTextContent("3");
  });

  it.each([0, undefined])(
    "shows no jobs link when the viewer has %s jobs",
    (myJobsCount) => {
      render(<AgentDetailHeader agent={agent} myJobsCount={myJobsCount} />);

      expect(
        screen.queryByRole("link", { name: /yourJobs/ }),
      ).not.toBeInTheDocument();
    },
  );

  it("opens New task with this agent mentioned, and submits nothing", async () => {
    const user = userEvent.setup();
    render(
      <OrganizationSeatContext value={true}>
        <AgentDetailHeader agent={agent} />
      </OrganizationSeatContext>,
    );

    await user.click(screen.getByRole("button", { name: "startTask" }));

    expect(openNewTaskWizardMock).toHaveBeenCalledWith({
      projectId: null,
      prompt: "@agent-1 ",
    });
  });

  it("offers no Start a task to a member without a seat", () => {
    render(
      <OrganizationSeatContext value={false}>
        <AgentDetailHeader agent={agent} />
      </OrganizationSeatContext>,
    );

    expect(
      screen.queryByRole("button", { name: "startTask" }),
    ).not.toBeInTheDocument();
  });
});
