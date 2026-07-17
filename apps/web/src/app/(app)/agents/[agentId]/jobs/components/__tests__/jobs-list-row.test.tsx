import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { JobRow } from "@/app/agents/[agentId]/jobs/components/jobs-list";
import type { JobSummary } from "@/lib/clients/generated/core";
import { JobType, SokosumiJobStatus } from "@/lib/clients/generated/core";

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
