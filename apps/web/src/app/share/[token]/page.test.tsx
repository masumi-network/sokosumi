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

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    dateTime: (value: Date | number) =>
      value instanceof Date ? value.toISOString() : String(value),
  }),
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
        if (key === "originFromApp") {
          return `from ${values?.appName ?? ""}`;
        }

        if (key === "actionChargedCredits") {
          return `charged ${values?.credits ?? 0} credits`;
        }

        if (key === "actionTriedChargedCredits") {
          return `tried to charge ${values?.credits ?? 0} credits`;
        }

        const detailLabels: Record<string, string> = {
          activity: "Activities",
          emptyActivity: "No activities yet.",
          expand: "Expand",
          collapse: "Show less",
          jobs: "Jobs",
          jobsUntitled: "Untitled job",
          properties: "Properties",
          status: "Status",
          coworker: "Coworker",
          created: "Created",
          updated: "Updated",
          actorSystem: "System",
          actionCommented: "commented",
          actionUpdatedStatus: "changed status to",
          sourcesFiles: "Files",
          sourcesLinks: "Links",
          "channelApp.email": "Email",
          "channelApp.sokosumi": "Sokosumi",
        };

        return detailLabels[key] ?? key;
      }

      if (namespace === "Share.Tasks.Page") {
        const pageLabels: Record<string, string> = {
          eyebrow: "Public task",
          descriptionEmpty: "No description provided.",
          jobsEmpty: "No linked jobs.",
          jobCreatedAt: `Created ${values?.date ?? ""}`,
          jobCompletedAt: `Completed ${values?.date ?? ""}`,
          publicJobLink: "Open public job",
          privateJobLink: "Private job",
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

vi.mock("@/components/jobs/job-details/job-details-view", () => ({
  default: ({ job }: { job: { id: string } }) => {
    jobDetailsViewMock(job);
    return <div>job:{job.id}</div>;
  },
}));

vi.mock("@/components/expandable-markdown", () => ({
  ExpandableMarkdown: ({ content }: { content: string }) => (
    <div>{content}</div>
  ),
}));

vi.mock("@/components/sources/sources-grid", () => ({
  SourcesGrid: ({
    title,
    blobs,
    links,
  }: {
    title: string;
    blobs?: Array<{ id: string }>;
    links?: Array<{ id: string }>;
  }) => <div>{`${title}:${blobs?.length ?? links?.length ?? 0}`}</div>,
}));

vi.mock("@/components/jobs/job-status-badge", () => ({
  JobStatusBadge: ({ status }: { status: string }) => <div>{status}</div>,
}));

vi.mock("@/lib/utils/datetime", () => ({
  formatTimeAgo: (value: string | Date) =>
    `ago:${value instanceof Date ? value.toISOString() : value}`,
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
        owner: {
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
        assignee: {
          id: "cow_1",
          name: "Ops Agent",
          slug: "ops-agent",
          image: null,
        },
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
            id: "evt_status",
            createdAt: new Date("2026-03-30T10:05:00.000Z"),
            updatedAt: new Date("2026-03-30T10:05:00.000Z"),
            channel: "SOKOSUMI",
            origin: "SOKOSUMI",
            status: "READY",
            comment: null,
            credits: null,
            actorName: "Ada Lovelace",
            actorImage: null,
          },
          {
            id: "evt_comment",
            createdAt: new Date("2026-03-30T10:15:00.000Z"),
            updatedAt: new Date("2026-03-30T10:15:00.000Z"),
            channel: "EMAIL",
            origin: "EMAIL",
            status: "COMPLETED",
            comment: "Detailed update from coworker",
            credits: 372,
            transactionId: "txn_comment_372",
            actorName: "Ops Agent",
            actorImage: null,
          },
          {
            id: "evt_auth",
            createdAt: new Date("2026-03-30T10:25:00.000Z"),
            updatedAt: new Date("2026-03-30T10:25:00.000Z"),
            channel: "SOKOSUMI",
            origin: "SOKOSUMI",
            status: "AUTHENTICATION_REQUIRED",
            comment: null,
            credits: null,
            actorName: null,
            actorImage: null,
          },
        ],
      },
    });

    const { default: SharePage } = await import("./page");
    const { container } = render(
      await SharePage({
        params: Promise.resolve({ token: "public-share-token" }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Shared Task" })).toBeVisible();
    expect(screen.getAllByText("Ops Agent")).toHaveLength(3);
    expect(screen.getByText("Research Agent")).toBeVisible();
    expect(screen.getByText("Private Agent")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Activities" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open public job" }),
    ).toHaveAttribute("href", "/share/job-share-token");
    expect(screen.getByText("Private job")).toBeVisible();
    expect(screen.getByText("Ada Lovelace")).toBeVisible();
    expect(screen.getByText("commented")).toBeVisible();
    expect(screen.getByText("changed status to")).toBeVisible();
    expect(screen.getByText("from Email")).toBeVisible();
    expect(screen.getByText("from Sokosumi")).toBeVisible();
    expect(screen.getByText("Detailed update from coworker")).toBeVisible();
    expect(screen.getByText("charged 372 credits")).toBeVisible();
    expect(screen.getByText("ago:2026-03-30T10:15:00.000Z")).toBeVisible();
    expect(screen.getByText("ago:2026-03-30T10:05:00.000Z")).toBeVisible();
    expect(screen.getByTestId("status-dot-evt_status")).toBeInTheDocument();
    expect(screen.queryByTestId("status-dot-evt_auth")).not.toBeInTheDocument();
    expect(screen.getByTestId("activity-row-evt_comment")).toHaveClass(
      "border-stone-500/30",
    );
    const renderedRows = Array.from(
      container.querySelectorAll("[data-testid^='activity-row-']"),
    ).map((element) => element.getAttribute("data-testid"));
    expect(renderedRows).toEqual([
      "activity-row-evt_comment",
      "activity-row-evt_status",
    ]);
  });

  it("renders settled credit-only share events as charged copy", async () => {
    getPubliclySharedResourceMock.mockResolvedValue({
      kind: "task",
      share: {
        allowSearchIndexing: true,
      },
      task: {
        id: "task_credit_only",
        createdAt: new Date("2026-03-30T10:00:00.000Z"),
        updatedAt: new Date("2026-03-30T11:00:00.000Z"),
        name: "Credit Only Task",
        description: null,
        status: "READY",
        assignee: null,
        coworker: null,
        jobs: [],
        events: [
          {
            id: "evt_credit_only",
            createdAt: new Date("2026-03-30T10:20:00.000Z"),
            updatedAt: new Date("2026-03-30T10:20:00.000Z"),
            channel: "SOKOSUMI",
            origin: "SOKOSUMI",
            status: null,
            comment: null,
            credits: 125,
            transactionId: "txn_123",
            actorName: "Ada Lovelace",
            actorImage: null,
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

    expect(screen.getByText("charged 125 credits")).toBeVisible();
    expect(screen.queryByText("changed status to")).not.toBeInTheDocument();
  });

  it("renders attempted credit copy for out-of-credits share events", async () => {
    getPubliclySharedResourceMock.mockResolvedValue({
      kind: "task",
      share: {
        allowSearchIndexing: true,
      },
      task: {
        id: "task_attempted_credit",
        createdAt: new Date("2026-03-30T10:00:00.000Z"),
        updatedAt: new Date("2026-03-30T11:00:00.000Z"),
        name: "Attempted Credit Task",
        description: null,
        status: "OUT_OF_CREDITS",
        assignee: null,
        coworker: null,
        jobs: [],
        events: [
          {
            id: "evt_attempted_credit",
            createdAt: new Date("2026-03-30T10:20:00.000Z"),
            updatedAt: new Date("2026-03-30T10:20:00.000Z"),
            channel: "SOKOSUMI",
            origin: "SOKOSUMI",
            status: "OUT_OF_CREDITS",
            comment: null,
            credits: 210,
            transactionId: null,
            actorName: "Ada Lovelace",
            actorImage: null,
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

    expect(screen.getByText("tried to charge 210 credits")).toBeVisible();
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
