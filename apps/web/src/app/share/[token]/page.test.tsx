import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPubliclySharedResourceMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const jobDetailsViewMock = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "en"),
  getTranslations: vi.fn(async (namespace: string) => {
    return (key: string, values?: Record<string, unknown>) => {
      if (namespace === "Share.Jobs.Metadata") {
        if (key === "defaultName") return "Untitled job";
        if (key === "title") return `Shared: ${values?.name ?? "Untitled job"}`;
        if (key === "description") return "Shared job description";
      }

      if (namespace === "Share.Tasks.Metadata") {
        if (key === "title")
          return `Shared task: ${values?.name ?? "Untitled task"}`;
        if (key === "description") return "Shared task description";
      }

      if (namespace === "App.Tasks.Detail") {
        const detailLabels: Record<string, string> = {
          expand: "Expand",
          collapse: "Show less",
          jobs: "Jobs",
          jobsUntitled: "Untitled job",
          properties: "Properties",
          status: "Status",
          coworker: "Coworker",
          created: "Created",
          updated: "Updated",
          "originApp.sokosumi": "Sokosumi",
        };

        return detailLabels[key] ?? key;
      }

      if (namespace === "Share.Tasks.Page") {
        const pageLabels: Record<string, string> = {
          eyebrow: "Public task",
          descriptionEmpty: "No description provided.",
          jobsEmpty: "No linked jobs.",
          milestonesTitle: "Milestones",
          milestonesEmpty: "No milestones yet.",
          jobCreatedAt: `Created ${values?.date ?? ""}`,
          jobCompletedAt: `Completed ${values?.date ?? ""}`,
          publicJobLink: "Open public job",
          privateJobLink: "Private job",
          chargedCredits: `${values?.credits ?? 0} credits charged`,
        };

        return pageLabels[key] ?? key;
      }

      return key;
    };
  }),
}));

vi.mock("@/lib/services", () => ({
  shareService: {
    getPubliclySharedResource: getPubliclySharedResourceMock,
  },
}));

vi.mock("@/components/jobs", () => ({
  JobDetailsView: ({ job }: { job: { id: string } }) => {
    jobDetailsViewMock(job);
    return <div>job:{job.id}</div>;
  },
}));

vi.mock("@/components/expandable-markdown", () => ({
  ExpandableMarkdown: ({ content }: { content: string }) => (
    <div>{content}</div>
  ),
}));

vi.mock("@/components/jobs/job-status-badge", () => ({
  JobStatusBadge: ({ status }: { status: string }) => <div>{status}</div>,
}));

describe("canonical share page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders shared jobs from the canonical token route", async () => {
    getPubliclySharedResourceMock.mockResolvedValue({
      kind: "job",
      share: {
        allowSearchIndexing: true,
      },
      job: {
        id: "job_123",
        name: "Shared Job",
        user: {
          name: "Ada Lovelace",
        },
        agent: {
          name: "Research Agent",
          overrideName: null,
          image: null,
          overrideImage: null,
        },
      },
    });

    const { default: SharePage } = await import("./page");
    render(
      await SharePage({
        params: Promise.resolve({ token: "public-share-token" }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Research Agent" }),
    ).toBeVisible();
    expect(screen.getByText("job:job_123")).toBeVisible();
    expect(jobDetailsViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job_123" }),
    );
  });

  it("renders shared tasks with linked job visibility", async () => {
    getPubliclySharedResourceMock.mockResolvedValue({
      kind: "task",
      share: {
        allowSearchIndexing: true,
      },
      task: {
        id: "task_123",
        createdAt: new Date("2026-03-30T10:00:00.000Z"),
        updatedAt: new Date("2026-03-30T11:00:00.000Z"),
        name: "Shared Task",
        description: "Shared task description",
        status: "READY",
        coworker: {
          id: "cow_1",
          name: "Ops Agent",
          slug: "ops-agent",
          image: null,
        },
        jobs: [
          {
            id: "job_1",
            createdAt: new Date("2026-03-30T10:10:00.000Z"),
            completedAt: null,
            name: "Visible Job",
            status: "processing",
            agentName: "Research Agent",
            shareToken: "job-share-token",
          },
          {
            id: "job_2",
            createdAt: new Date("2026-03-30T10:12:00.000Z"),
            completedAt: new Date("2026-03-30T10:20:00.000Z"),
            name: "Private Job",
            status: "processing",
            agentName: "Private Agent",
            shareToken: null,
          },
        ],
        events: [
          {
            id: "evt_1",
            createdAt: new Date("2026-03-30T10:15:00.000Z"),
            updatedAt: new Date("2026-03-30T10:15:00.000Z"),
            origin: "SOKOSUMI",
            status: "RUNNING",
            credits: 3,
          },
        ],
      },
    });

    const { default: SharePage } = await import("./page");
    render(
      await SharePage({
        params: Promise.resolve({ token: "public-share-token" }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Shared Task" })).toBeVisible();
    expect(screen.getByText("Ops Agent")).toBeVisible();
    expect(screen.getByText("Research Agent")).toBeVisible();
    expect(screen.getByText("Private Agent")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open public job" }),
    ).toHaveAttribute("href", "/share/job-share-token");
    expect(screen.getByText("Private job")).toBeVisible();
    expect(screen.getByText("3 credits charged")).toBeVisible();
  });

  it("delegates missing shared resources to notFound", async () => {
    getPubliclySharedResourceMock.mockResolvedValue(null);

    const { default: SharePage } = await import("./page");

    await expect(
      SharePage({
        params: Promise.resolve({ token: "public-share-token" }),
      }),
    ).rejects.toThrow("notFound");
    expect(notFoundMock).toHaveBeenCalled();
  });
});
