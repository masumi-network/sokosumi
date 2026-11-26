import type { JobSummary } from "@sokosumi/core-client";
import { JobType, SokosumiJobStatus } from "@sokosumi/core-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  JobRow,
  JobsList,
} from "@/app/agents/[agentId]/jobs/components/jobs-list";

vi.mock("next-intl", () => ({
  useTimeZone: () => "UTC",
  useLocale: () => "en",
  useTranslations:
    () => (key: string, values?: Record<string, string | number>) =>
      values ? `${key}:${Object.values(values).join(",")}` : key,
}));

const search = vi.hoisted(() => ({ value: "", clear: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("ably/react", () => ({
  ChannelProvider: ({ children }: { children: ReactNode }) => children,
  useChannel: vi.fn(),
}));

vi.mock("@/contexts/lazy-ably-provider", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../jobs-search", () => ({
  JobsSearch: () => null,
  filterJobsByQuery: (jobs: JobSummary[], query: string) => (query ? [] : jobs),
  useJobsSearchQuery: () => ({
    searchValue: search.value,
    handleInputChange: vi.fn(),
    handleClear: search.clear,
  }),
}));

vi.mock("../jobs-list.utils", () => ({
  buildJobDayGroups: () => [],
}));

function createJob(
  overrides: Partial<Omit<JobSummary, "owner">> & {
    owner?: Partial<NonNullable<JobSummary["owner"]>>;
  } = {},
): JobSummary {
  const { owner: ownerOverrides, ...rest } = overrides;
  const owner = {
    id: ownerOverrides?.id ?? "user-1",
    name: ownerOverrides?.name ?? "User",
    image: ownerOverrides?.image ?? null,
  };

  return {
    id: "job-id",
    creator: null,
    name: "Job name",
    createdAt: new Date("2026-02-13T10:00:00.000Z"),
    updatedAt: new Date("2026-02-13T10:00:00.000Z"),
    completedAt: null,
    status: SokosumiJobStatus.PROCESSING,
    jobType: JobType.FREE,
    agentId: "agent-1",
    ownerId: owner.id,
    owner,
    userId: owner.id,
    organizationId: null,
    projectId: null,
    workspace: {
      id: "workspace-1",
      organizationId: null,
      organization: null,
    },
    taskId: null,
    credits: 0,
    onChainStatus: null,
    onChainTransactionHash: null,
    result: null,
    resultHash: null,
    user: owner,
    ...rest,
    jobStatusSettled: rest.jobStatusSettled ?? false,
  };
}

describe("JobRow", () => {
  it("does not render sharing badges for non-owned jobs", () => {
    const job = createJob({
      ownerId: "another-user",
      owner: {
        id: "another-user",
        name: "Jane",
        image: "https://example.com/avatar.png",
      },
    });

    render(<JobRow job={job} selected={false} onClick={vi.fn()} />);

    expect(screen.queryByTestId("shared-job-avatar")).not.toBeInTheDocument();
  });

  it("does not render shared avatar for owned jobs", () => {
    const job = createJob({
      ownerId: "current-user",
    });

    render(<JobRow job={job} selected={false} onClick={vi.fn()} />);

    expect(screen.queryByTestId("shared-job-avatar")).not.toBeInTheDocument();
  });
});

describe("JobsList empty state", () => {
  function renderList(jobs: JobSummary[]) {
    render(
      <JobsList
        jobs={jobs}
        jobsNextCursor={null}
        userId="user-1"
        agentId="agent-1"
      />,
    );
  }

  it("says no jobs exist when the agent has none", () => {
    search.value = "";
    renderList([]);

    expect(screen.getByText("emptyJobs")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "clearSearch" }),
    ).not.toBeInTheDocument();
  });

  it("keeps an empty status region mounted before any miss", () => {
    search.value = "";
    renderList([createJob()]);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("names the missed query and offers to clear it", () => {
    search.value = "zebra";
    search.clear.mockClear();
    renderList([createJob()]);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("noMatches:zebra");
    const clear = screen.getByRole("button", { name: "clearSearch" });
    expect(status).not.toContainElement(clear);
    fireEvent.click(clear);
    expect(search.clear).toHaveBeenCalledOnce();
    search.value = "";
  });
});
