import { convertCreditsToCents } from "@sokosumi/utils";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startJobMock = vi.fn();
const uploadInputDataFilesMock = vi.fn();
const toastErrorMock = vi.fn();
const pushMock = vi.fn();
const setLoadingMock = vi.fn();
const onSuccessMock = vi.fn();
const trackMock = vi.fn();
const agentHiredMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => pushMock(...args),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@vercel/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    agentHired: (...args: unknown[]) => agentHiredMock(...args),
  },
}));

vi.mock("@/lib/helpers/agent", () => ({
  getAgentName: () => "Demo Agent",
  getAgentCredits: () => 5,
}));

vi.mock("@/lib/actions", () => ({
  CommonErrorCode: {
    UNAUTHENTICATED: "UNAUTHENTICATED",
    BAD_INPUT: "BAD_INPUT",
  },
  JobErrorCode: {
    INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  },
  startJob: (...args: unknown[]) => startJobMock(...args),
}));

vi.mock("@/lib/utils/user-file-upload.client", () => ({
  getUserFileUploadErrorMessage: (error: unknown, fallback: string) =>
    error instanceof TypeError
      ? "Network error while uploading file. Please try again."
      : error instanceof Error
        ? error.message
        : fallback,
  uploadInputDataFiles: (...args: unknown[]) =>
    uploadInputDataFilesMock(...args),
}));

import { useJobSubmission } from "@/hooks/use-job-submission";

describe("useJobSubmission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startJobMock.mockResolvedValue({
      ok: true,
      data: {
        jobId: "job_123",
      },
    });
    uploadInputDataFilesMock.mockImplementation(async (inputData) => {
      if (
        inputData &&
        typeof inputData === "object" &&
        "attachment" in inputData
      ) {
        inputData.attachment = "https://blob.example/users/user_123/report.pdf";
      }
    });
  });

  it("uploads file inputs before starting an immediate job", async () => {
    const { result } = renderHook(() =>
      useJobSubmission({
        agent: {
          id: "agent_1",
          credits: 5,
        } as never,
        inputSchema: [] as never,
        setLoading: setLoadingMock,
        onSuccess: onSuccessMock,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit({
        attachment: new File(["hello"], "report.pdf", {
          type: "application/pdf",
        }),
      });
    });

    expect(uploadInputDataFilesMock).toHaveBeenCalledWith({
      attachment: "https://blob.example/users/user_123/report.pdf",
    });
    expect(startJobMock).toHaveBeenCalledWith({
      input: {
        agentId: "agent_1",
        maxAcceptedCents: convertCreditsToCents(5),
        inputSchema: [],
        inputData: {
          attachment: "https://blob.example/users/user_123/report.pdf",
        },
      },
    });
    expect(uploadInputDataFilesMock.mock.invocationCallOrder[0]).toBeLessThan(
      startJobMock.mock.invocationCallOrder[0],
    );
    expect(setLoadingMock).toHaveBeenNthCalledWith(1, true);
    expect(setLoadingMock).toHaveBeenLastCalledWith(false);
    expect(onSuccessMock).toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/agents/agent_1/jobs/job_123");
  });

  it("shows the generic error when the action throws after upload succeeds", async () => {
    startJobMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const { result } = renderHook(() =>
      useJobSubmission({
        agent: {
          id: "agent_1",
          credits: 5,
        } as never,
        inputSchema: [] as never,
        setLoading: setLoadingMock,
        onSuccess: onSuccessMock,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit({
        attachment: new File(["hello"], "report.pdf", {
          type: "application/pdf",
        }),
      });
    });

    expect(uploadInputDataFilesMock).toHaveBeenCalled();
    expect(startJobMock).toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("Error.default");
  });
});
