import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectJobsSection } from "@/app/projects/components/project-jobs-section";
import { SokosumiJobStatus } from "@/lib/clients/generated/core";
import type { JobSummary } from "@/lib/clients/generated/core/types.gen";

const { refreshMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/lib/actions/project/action", () => ({
  addProjectJob: vi.fn(),
  removeProjectJob: vi.fn(),
}));

vi.mock("@/app/projects/components/project-job-picker-dialog", () => ({
  ProjectJobPickerDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="job-picker">Picker</div> : null,
}));

vi.mock("@/components/jobs/job-status-badge", () => ({
  JobStatusBadge: () => <span>Completed</span>,
}));

vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({
    formatTimeAgo: () => "2h ago",
  }),
}));

const labels = {
  title: "Jobs",
  empty: "No jobs linked to this project yet.",
  add: "Add job",
  remove: "Remove job",
  pickerTitle: "Add job",
  pickerDescription: "Choose an unassigned job.",
  pickerSearchPlaceholder: "Search jobs...",
  pickerEmpty: "No unassigned jobs found.",
  pickerLoading: "Loading jobs...",
  pickerError: "Failed to load jobs.",
  confirmRemove: "Remove this job from the project?",
  cancel: "Cancel",
  untitled: "Untitled job",
  errors: {
    add: "Couldn't add job",
    remove: "Couldn't remove job",
  },
};

function buildJob(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: "job-1",
    name: "Run analysis",
    status: SokosumiJobStatus.COMPLETED,
    createdAt: new Date("2026-05-27T10:00:00.000Z"),
    agentId: "agent-1",
    ...overrides,
  } as JobSummary;
}

describe("ProjectJobsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders list box chrome with divide-y hover rows and remove button", () => {
    render(
      <ProjectJobsSection
        projectId="project-1"
        jobs={[buildJob()]}
        labels={labels}
      />,
    );

    expect(screen.getByRole("heading", { name: "Jobs" })).toBeInTheDocument();

    const listBox = screen
      .getByTestId("project-jobs-section")
      .querySelector(".bg-muted\\/30");
    expect(listBox?.className).toContain("md:rounded-xl");

    const row = screen.getByRole("listitem");
    expect(row.className).toContain("hover:bg-muted/50");
    expect(row.className).not.toContain("bg-muted/40");
    expect(row.className).not.toMatch(/\bborder\b/);

    expect(screen.getByRole("link", { name: /Run analysis/ })).toHaveAttribute(
      "href",
      "/agents/agent-1/jobs/job-1",
    );
    expect(
      screen.getByRole("button", { name: "Remove job" }),
    ).toBeInTheDocument();
  });

  it("shows empty copy inside the list box and keeps add", async () => {
    const user = userEvent.setup();
    render(
      <ProjectJobsSection projectId="project-1" jobs={[]} labels={labels} />,
    );

    expect(
      screen.getByText("No jobs linked to this project yet."),
    ).toBeInTheDocument();

    const listBox = screen
      .getByTestId("project-jobs-section")
      .querySelector(".bg-muted\\/30");
    expect(listBox?.className).toContain("md:rounded-xl");
    expect(listBox).toContainElement(
      screen.getByText("No jobs linked to this project yet."),
    );

    await user.click(screen.getByRole("button", { name: "Add job" }));
    expect(screen.getByTestId("job-picker")).toBeInTheDocument();
  });
});
