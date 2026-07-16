import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JobShareModal from "@/components/jobs/job-details/job-share-modal";
import type { Job } from "@/lib/clients/generated/core";
import { SokosumiJobStatus } from "@/lib/clients/generated/core";

const { MockCoreApiRequestError } = vi.hoisted(() => {
  class MockCoreApiRequestError extends Error {
    status?: number;

    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options?.status;
    }
  }

  return { MockCoreApiRequestError };
});

const routerPushMock = vi.fn();
const setQueryDataMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const putJobShareMock = vi.fn();
const deleteJobShareMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    setQueryData: (...args: unknown[]) => setQueryDataMock(...args),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  CoreApiRequestError: MockCoreApiRequestError,
  coreClient: {
    putJobShare: (...args: unknown[]) => putJobShareMock(...args),
    deleteJobShare: (...args: unknown[]) => deleteJobShareMock(...args),
  },
}));

// The real @/queries barrel reaches the `getJob` server action and its
// server-only auth/env imports; the modal only needs the query key.
vi.mock("@/queries", () => ({
  getJobQueryKey: (jobId: string) => ["jobs", jobId],
}));

function createJob(overrides: Partial<Job>): Job {
  return {
    id: "job-1",
    name: "Job name",
    createdAt: new Date("2026-02-13T10:00:00.000Z"),
    updatedAt: new Date("2026-02-13T10:00:00.000Z"),
    completedAt: null,
    status: SokosumiJobStatus.PROCESSING,
    jobType: "FREE",
    agentId: "agent-1",
    userId: "user-1",
    organizationId: null,
    organization: null,
    projectId: null,
    agentJobId: "agent-job-1",
    identifierFromPurchaser: null,
    share: null,
    taskId: null,
    events: [],
    credits: 0,
    input: null,
    inputHash: null,
    inputSchema: null,
    result: null,
    resultHash: null,
    user: {
      id: "user-1",
      name: "User",
      image: null,
    },
    workspace: {
      id: "workspace-1",
      organizationId: null,
      organization: null,
    },
    agent: {
      id: "agent-1",
      name: "Agent",
    },
    ...overrides,
    jobStatusSettled: overrides?.jobStatusSettled ?? false,
  };
}

describe("JobShareModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows only public and private sharing options", () => {
    render(<JobShareModal open onOpenChange={vi.fn()} job={createJob({})} />);

    expect(screen.getByText("publicAccessTitle")).toBeInTheDocument();
    expect(screen.getByText("privateAccessTitle")).toBeInTheDocument();
    expect(
      screen.queryByText("organizationAccessTitle"),
    ).not.toBeInTheDocument();
  });

  it("enables public sharing and then shows search indexing controls", async () => {
    putJobShareMock.mockResolvedValue({
      id: "share-1",
      jobId: "job-1",
      token: "public-token",
      allowSearchIndexing: true,
      createdAt: new Date("2026-02-13T10:00:00.000Z"),
      updatedAt: new Date("2026-02-13T10:00:00.000Z"),
    });

    render(<JobShareModal open onOpenChange={vi.fn()} job={createJob({})} />);

    fireEvent.click(screen.getByText("publicAccessTitle"));

    await waitFor(() => {
      expect(putJobShareMock).toHaveBeenCalledWith("job-1", {
        allowSearchIndexing: true,
      });
    });

    expect(setQueryDataMock).toHaveBeenCalledWith(
      ["jobs", "job-1"],
      expect.any(Function),
    );

    expect(screen.getByText("allowSearchIndexing")).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "http://localhost:3000/share/public-token",
      }),
    ).toBeInTheDocument();
  });

  it("updates search indexing for public shares", async () => {
    putJobShareMock.mockResolvedValue({
      id: "share-1",
      jobId: "job-1",
      token: "public-token",
      allowSearchIndexing: false,
      createdAt: new Date("2026-02-13T10:00:00.000Z"),
      updatedAt: new Date("2026-02-13T10:00:00.000Z"),
    });

    render(
      <JobShareModal
        open
        onOpenChange={vi.fn()}
        job={createJob({
          share: {
            id: "share-1",
            jobId: "job-1",
            token: "public-token",
            allowSearchIndexing: true,
            createdAt: new Date("2026-02-13T10:00:00.000Z"),
            updatedAt: new Date("2026-02-13T10:00:00.000Z"),
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() => {
      expect(putJobShareMock).toHaveBeenCalledWith("job-1", {
        allowSearchIndexing: false,
      });
    });

    expect(setQueryDataMock).toHaveBeenCalledWith(
      ["jobs", "job-1"],
      expect.any(Function),
    );
  });

  it("removes public sharing without refreshing the page", async () => {
    deleteJobShareMock.mockResolvedValue(undefined);

    render(
      <JobShareModal
        open
        onOpenChange={vi.fn()}
        job={createJob({
          share: {
            id: "share-1",
            jobId: "job-1",
            token: "public-token",
            allowSearchIndexing: true,
            createdAt: new Date("2026-02-13T10:00:00.000Z"),
            updatedAt: new Date("2026-02-13T10:00:00.000Z"),
          },
        })}
      />,
    );

    fireEvent.click(screen.getByText("privateAccessTitle"));

    await waitFor(() => {
      expect(deleteJobShareMock).toHaveBeenCalledWith("job-1");
    });

    expect(setQueryDataMock).toHaveBeenCalledWith(
      ["jobs", "job-1"],
      expect.any(Function),
    );
  });

  it("keeps public access selected when it is already public", async () => {
    render(
      <JobShareModal
        open
        onOpenChange={vi.fn()}
        job={createJob({
          share: {
            id: "share-1",
            jobId: "job-1",
            token: "public-token",
            allowSearchIndexing: true,
            createdAt: new Date("2026-02-13T10:00:00.000Z"),
            updatedAt: new Date("2026-02-13T10:00:00.000Z"),
          },
        })}
      />,
    );

    fireEvent.click(screen.getByText("publicAccessTitle"));

    await waitFor(() => {
      expect(putJobShareMock).not.toHaveBeenCalled();
    });
  });

  it("routes unauthenticated share errors to the login toast action", async () => {
    putJobShareMock.mockRejectedValue(
      new MockCoreApiRequestError("Unauthorized", { status: 401 }),
    );

    render(<JobShareModal open onOpenChange={vi.fn()} job={createJob({})} />);

    fireEvent.click(screen.getByText("publicAccessTitle"));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Errors.unauthenticated", {
        action: {
          label: "Errors.unauthenticatedAction",
          onClick: expect.any(Function),
        },
      });
    });
  });
});
