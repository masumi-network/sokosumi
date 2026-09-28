import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JobDetailsPresentationProps } from "./job-details-view";

const loadJobDetailsMock = vi.fn();
const getMyMembersWithOrganizationsMock = vi.fn();
const getTranslationsMock = vi.fn();
const autoContextSwitchMock = vi.fn();
const presentationMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  HydrationBoundary: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="hydration-boundary">{children}</div>
  ),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: (...args: unknown[]) => getTranslationsMock(...args),
}));

vi.mock("./load-job-details", () => ({
  loadJobDetails: (...args: unknown[]) => loadJobDetailsMock(...args),
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

function Presentation(props: JobDetailsPresentationProps) {
  presentationMock(props);
  return <div data-testid="job-details-presentation" />;
}

async function renderJobDetailsView(agentId = "agent-1", jobId = "job-1") {
  const { JobDetailsView } = await import("./job-details-view");
  return render(
    await JobDetailsView({
      agentId,
      jobId,
      children: (props) => <Presentation {...props} />,
    }),
  );
}

describe("JobDetailsView", () => {
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

  it("switches to the workspace organization instead of the billing organization", async () => {
    const job = {
      id: "job-1",
      organizationId: "org-billing",
      workspace: {
        organizationId: "org-workspace",
      },
    };
    loadJobDetailsMock.mockResolvedValue({
      activeOrganizationId: null,
      dehydratedState: "dehydrated",
      job,
      hasPersonalWorkspace: true,
      personalWorkspaceLabel: "Ada Lovelace",
      projectName: "Project",
      readOnly: false,
    });

    await renderJobDetailsView();

    expect(loadJobDetailsMock).toHaveBeenCalledWith({
      agentId: "agent-1",
      jobId: "job-1",
    });
    expect(autoContextSwitchMock).toHaveBeenCalledWith({
      activeOrganizationId: null,
      targetOrganizationId: "org-workspace",
      successMessage: 'switchedWorkspace:{"account":"Workspace Org"}',
    });
    expect(presentationMock).toHaveBeenCalledWith({
      job,
      organizations: [
        {
          organizationId: "org-workspace",
          organization: { id: "org-workspace", name: "Workspace Org" },
        },
      ],
      hasPersonalWorkspace: true,
      personalWorkspaceLabel: "Ada Lovelace",
      projectName: "Project",
      readOnly: false,
    });
    expect(screen.getByTestId("hydration-boundary")).toBeInTheDocument();
    expect(screen.getByTestId("job-details-presentation")).toBeInTheDocument();
  });

  it("uses the personal account label when the job is in the personal workspace", async () => {
    loadJobDetailsMock.mockResolvedValue({
      activeOrganizationId: "org-billing",
      dehydratedState: "dehydrated",
      job: {
        id: "job-1",
        organizationId: "org-billing",
        workspace: {
          organizationId: null,
        },
      },
      hasPersonalWorkspace: false,
      personalWorkspaceLabel: null,
      projectName: null,
      readOnly: true,
    });

    await renderJobDetailsView();

    expect(autoContextSwitchMock).toHaveBeenCalledWith({
      activeOrganizationId: "org-billing",
      targetOrganizationId: null,
      successMessage: 'switchedWorkspace:{"account":"Personal Account"}',
    });
    expect(presentationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        personalWorkspaceLabel: "Personal Account",
        hasPersonalWorkspace: false,
        projectName: null,
        readOnly: true,
      }),
    );
  });
});
