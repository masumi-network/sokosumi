import { JobType, SokosumiJobStatus } from "@sokosumi/utils";
import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { JobRow } from "@/app/agents/[agentId]/jobs/components/jobs-list";
import type { JobSummary } from "@/lib/clients/generated/core";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (_key: string) => "",
}));

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

vi.mock("@/contexts/alby-provider.dynamic", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../jobs-search", () => ({
  JobsSearch: () => null,
}));

vi.mock("../jobs-list.utils", () => ({
  buildJobDayGroups: () => [],
}));

function createJob(
  overrides: Partial<Omit<JobSummary, "user">> & {
    user?: Partial<NonNullable<JobSummary["user"]>>;
  } = {},
): JobSummary {
  const { user: userOverrides, ...rest } = overrides;

  return {
    id: "job-id",
    name: "Job name",
    createdAt: new Date("2026-02-13T10:00:00.000Z"),
    updatedAt: new Date("2026-02-13T10:00:00.000Z"),
    completedAt: null,
    status: SokosumiJobStatus.PROCESSING,
    jobType: JobType.FREE,
    agentId: "agent-1",
    userId: "user-1",
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
    user: {
      id: userOverrides?.id ?? "user-1",
      name: userOverrides?.name ?? "User",
      image: userOverrides?.image ?? null,
    },
    ...rest,
  };
}

describe("JobRow", () => {
  it("does not render sharing badges for non-owned jobs", () => {
    const job = createJob({
      userId: "another-user",
      user: {
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
      userId: "current-user",
    });

    render(<JobRow job={job} selected={false} onClick={vi.fn()} />);

    expect(screen.queryByTestId("shared-job-avatar")).not.toBeInTheDocument();
  });
});
