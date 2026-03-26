import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  JobType,
  SokosumiJobStatus,
  type JobWithSokosumiStatus,
} from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import JobShareModal from "@/components/jobs/job-details/job-share-modal";

const routerPushMock = vi.fn();
const routerRefreshMock = vi.fn();
const shareJobPubliclyMock = vi.fn();
const deleteJobShareMock = vi.fn();
const updateAllowSearchIndexingMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    refresh: routerRefreshMock,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/lib/actions", () => ({
  CommonErrorCode: {
    UNAUTHENTICATED: "UNAUTHENTICATED",
    UNAUTHORIZED: "UNAUTHORIZED",
  },
  JobErrorCode: {
    JOB_NOT_FOUND: "JOB_NOT_FOUND",
    JOB_SHARE_NOT_FOUND: "JOB_SHARE_NOT_FOUND",
  },
  deleteJobShare: (...args: unknown[]) => deleteJobShareMock(...args),
  shareJobPublicly: (...args: unknown[]) => shareJobPubliclyMock(...args),
  updateAllowSearchIndexing: (...args: unknown[]) =>
    updateAllowSearchIndexingMock(...args),
}));

function createJob(
  overrides: Partial<JobWithSokosumiStatus>,
): JobWithSokosumiStatus {
  return {
    id: "job-1",
    name: "Job name",
    createdAt: new Date("2026-02-13T10:00:00.000Z"),
    updatedAt: new Date("2026-02-13T10:00:00.000Z"),
    completedAt: null,
    status: SokosumiJobStatus.PROCESSING,
    jobType: JobType.FREE,
    agentId: "agent-1",
    userId: "user-1",
    organizationId: null,
    agentJobId: "agent-job-1",
    blockchainIdentifier: null,
    identifierFromPurchaser: null,
    payByTime: null,
    submitResultTime: null,
    unlockTime: null,
    externalDisputeUnlockTime: null,
    sellerVkey: null,
    transaction: null,
    transactionId: null,
    refundedTransaction: null,
    refundedTransactionId: null,
    share: null,
    taskId: null,
    task: null,
    purchase: null,
    jobScheduleId: null,
    jobSchedule: null,
    events: [],
    credits: 0,
    cents: BigInt(0),
    input: null,
    inputHash: null,
    inputSchema: null,
    result: null,
    resultHash: null,
    jobStatusSettled: false,
    user: {
      id: "user-1",
      name: "User",
      image: null,
    },
    organization: null,
    agent: {
      id: "agent-1",
      name: "Agent",
    },
    ...overrides,
  } as unknown as JobWithSokosumiStatus;
}

describe("JobShareModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows only public and private sharing options", () => {
    render(
      <JobShareModal open onOpenChange={vi.fn()} job={createJob({})} />,
    );

    expect(screen.getByText("publicAccessTitle")).toBeInTheDocument();
    expect(screen.getByText("privateAccessTitle")).toBeInTheDocument();
    expect(screen.queryByText("organizationAccessTitle")).not.toBeInTheDocument();
  });

  it("enables public sharing and then shows search indexing controls", async () => {
    shareJobPubliclyMock.mockResolvedValue({
      ok: true,
      data: {
        id: "share-1",
        token: "public-token",
        allowSearchIndexing: true,
      },
    });

    render(
      <JobShareModal open onOpenChange={vi.fn()} job={createJob({})} />,
    );

    fireEvent.click(screen.getByText("publicAccessTitle"));

    await waitFor(() => {
      expect(shareJobPubliclyMock).toHaveBeenCalledWith({ jobId: "job-1" });
    });

    expect(screen.getByText("allowSearchIndexing")).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "http://localhost:3000/share/jobs/public-token",
      }),
    ).toBeInTheDocument();
  });

  it("updates search indexing for public shares", async () => {
    updateAllowSearchIndexingMock.mockResolvedValue({
      ok: true,
      data: {
        id: "share-1",
        token: "public-token",
        allowSearchIndexing: false,
      },
    });

    render(
      <JobShareModal
        open
        onOpenChange={vi.fn()}
        job={createJob({
          share: {
            id: "share-1",
            token: "public-token",
            allowSearchIndexing: true,
          } as never,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() => {
      expect(updateAllowSearchIndexingMock).toHaveBeenCalledWith({
        jobShareId: "share-1",
        allowSearchIndexing: false,
      });
    });
  });

  it("keeps public access selected when it is already public", async () => {
    render(
      <JobShareModal
        open
        onOpenChange={vi.fn()}
        job={createJob({
          share: {
            id: "share-1",
            token: "public-token",
            allowSearchIndexing: true,
          } as never,
        })}
      />,
    );

    fireEvent.click(screen.getByText("publicAccessTitle"));

    await waitFor(() => {
      expect(shareJobPubliclyMock).not.toHaveBeenCalled();
      expect(deleteJobShareMock).not.toHaveBeenCalled();
    });
  });
});
