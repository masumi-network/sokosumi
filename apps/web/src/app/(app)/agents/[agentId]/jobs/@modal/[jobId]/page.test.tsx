import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadJobDetailsMock = vi.fn();
const getMyMembersWithOrganizationsMock = vi.fn();
const getTranslationsMock = vi.fn();
const autoContextSwitchMock = vi.fn();
const jobDetailsModalMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  HydrationBoundary: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="hydration-boundary">{children}</div>
  ),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: (...args: unknown[]) => getTranslationsMock(...args),
}));

vi.mock("@/app/agents/[agentId]/jobs/_lib/load-job-details", () => ({
  loadJobDetails: (...args: unknown[]) => loadJobDetailsMock(...args),
}));

vi.mock("@/app/agents/[agentId]/jobs/components/job-details-modal", () => ({
  JobDetailsModal: (props: unknown) => {
    jobDetailsModalMock(props);
    return <div data-testid="job-details-modal" />;
  },
}));

vi.mock("@/app/components/auto-context-switch", () => ({
  AutoContextSwitch: (props: unknown) => {
    autoContextSwitchMock(props);
    return <div data-testid="auto-context-switch" />;
  },
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getMyMembersWithOrganizations: (...args: unknown[]) =>
      getMyMembersWithOrganizationsMock(...args),
  },
}));

describe("JobDetailsModalPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyMembersWithOrganizationsMock.mockResolvedValue([
      {
        organizationId: "org-workspace",
        organization: { id: "org-workspace", name: "Workspace Org" },
      },
    ]);
    getTranslationsMock.mockImplementation(async (namespace: string) => {
      if (namespace === "Components.OrganizationSwitcher") {
        return (key: string) =>
          key === "personalAccount" ? "Personal Account" : key;
      }

      return (key: string, values?: Record<string, unknown>) =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    });
  });

  it("switches the modal flow to the workspace organization", async () => {
    loadJobDetailsMock.mockResolvedValue({
      activeOrganizationId: null,
      dehydratedState: "dehydrated",
      job: {
        id: "job-1",
        organizationId: "org-billing",
        workspace: {
          organizationId: "org-workspace",
        },
      },
      personalWorkspaceLabel: "Ada Lovelace",
      readOnly: false,
    });

    const { default: JobDetailsModalPage } = await import("./page");

    render(
      await JobDetailsModalPage({
        params: Promise.resolve({
          agentId: "agent-1",
          jobId: "job-1",
        }),
      }),
    );

    expect(autoContextSwitchMock).toHaveBeenCalledWith({
      activeOrganizationId: null,
      targetOrganizationId: "org-workspace",
      successMessage: 'switchedWorkspace:{"account":"Workspace Org"}',
    });
    expect(jobDetailsModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        personalWorkspaceLabel: "Ada Lovelace",
      }),
    );
    expect(screen.getByTestId("hydration-boundary")).toBeInTheDocument();
  });
});
