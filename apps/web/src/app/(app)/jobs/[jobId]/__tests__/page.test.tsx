import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadJobDetailsMock = vi.fn();
const getMyMembersWithOrganizationsMock = vi.fn();
const getTranslationsMock = vi.fn();
const autoContextSwitchMock = vi.fn();
const jobDetailsMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  HydrationBoundary: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="hydration-boundary">{children}</div>
  ),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: (...args: unknown[]) => getTranslationsMock(...args),
}));

vi.mock("@/lib/job/load-job-details", () => ({
  loadJobDetails: (...args: unknown[]) => loadJobDetailsMock(...args),
}));

vi.mock("@/app/components/auto-context-switch", () => ({
  AutoContextSwitch: (props: unknown) => {
    autoContextSwitchMock(props);
    return <div data-testid="auto-context-switch" />;
  },
}));

vi.mock("@/components/jobs", () => ({
  JobDetails: (props: unknown) => {
    jobDetailsMock(props);
    return <div data-testid="job-details" />;
  },
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getMyMembersWithOrganizations: (...args: unknown[]) =>
      getMyMembersWithOrganizationsMock(...args),
  },
}));

describe("JobDetailsPage (/jobs/{jobId})", () => {
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

  it("loads job by id and renders JobDetails", async () => {
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
      projectName: null,
      readOnly: false,
    });

    const { default: JobDetailsPage } = await import("../page");

    render(
      await JobDetailsPage({
        params: Promise.resolve({
          jobId: "job-1",
        }),
      }),
    );

    expect(loadJobDetailsMock).toHaveBeenCalledWith({ jobId: "job-1" });
    expect(autoContextSwitchMock).toHaveBeenCalledWith({
      activeOrganizationId: null,
      targetOrganizationId: "org-workspace",
      successMessage: 'switchedWorkspace:{"account":"Workspace Org"}',
    });
    expect(jobDetailsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        personalWorkspaceLabel: "Ada Lovelace",
        showAgentHeader: false,
      }),
    );
    expect(screen.getByTestId("hydration-boundary")).toBeInTheDocument();
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
      personalWorkspaceLabel: null,
      projectName: null,
      readOnly: false,
    });

    const { default: JobDetailsPage } = await import("../page");

    render(
      await JobDetailsPage({
        params: Promise.resolve({
          jobId: "job-1",
        }),
      }),
    );

    expect(autoContextSwitchMock).toHaveBeenCalledWith({
      activeOrganizationId: "org-billing",
      targetOrganizationId: null,
      successMessage: 'switchedWorkspace:{"account":"Personal Account"}',
    });
  });

  it("generateMetadata prefers the job name, then agent name", async () => {
    loadJobDetailsMock.mockResolvedValue({
      activeOrganizationId: null,
      dehydratedState: "dehydrated",
      job: {
        id: "job-1",
        name: "  Named Job  ",
        agent: { id: "agent-1", name: "Research Agent" },
        workspace: { organizationId: null },
      },
      personalWorkspaceLabel: null,
      projectName: null,
      readOnly: false,
    });

    const { generateMetadata } = await import("../page");
    await expect(
      generateMetadata({
        params: Promise.resolve({ jobId: "job-1" }),
      }),
    ).resolves.toEqual({ title: "Named Job" });

    loadJobDetailsMock.mockResolvedValue({
      activeOrganizationId: null,
      dehydratedState: "dehydrated",
      job: {
        id: "job-1",
        name: null,
        agent: { id: "agent-1", name: "Research Agent" },
        workspace: { organizationId: null },
      },
      personalWorkspaceLabel: null,
      projectName: null,
      readOnly: false,
    });

    await expect(
      generateMetadata({
        params: Promise.resolve({ jobId: "job-1" }),
      }),
    ).resolves.toEqual({ title: "Research Agent" });
  });
});
