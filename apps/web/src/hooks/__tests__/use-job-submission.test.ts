import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startDemoJobMock = vi.fn();
const startJobMock = vi.fn();
const createScheduleMock = vi.fn();
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
}));

vi.mock("@/lib/actions", () => ({
  CommonErrorCode: {
    UNAUTHENTICATED: "UNAUTHENTICATED",
    BAD_INPUT: "BAD_INPUT",
  },
  JobErrorCode: {
    INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  },
  startDemoJob: (...args: unknown[]) => startDemoJobMock(...args),
  startJob: (...args: unknown[]) => startJobMock(...args),
}));

vi.mock("@/lib/actions/job-schedule", () => ({
  createSchedule: (...args: unknown[]) => createScheduleMock(...args),
}));

vi.mock("@/lib/utils/user-file-upload.client", () => ({
  getUserFileUploadErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
  uploadInputDataFiles: (...args: unknown[]) =>
    uploadInputDataFilesMock(...args),
}));

import { useJobSubmission } from "@/hooks/use-job-submission";
import { JobScheduleType } from "@/lib/types/job";

describe("useJobSubmission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startDemoJobMock.mockResolvedValue({
      ok: true,
      data: {
        jobId: "job_demo",
      },
    });
    startJobMock.mockResolvedValue({
      ok: true,
      data: {
        jobId: "job_123",
      },
    });
    createScheduleMock.mockResolvedValue({
      ok: true,
      data: {
        jobId: "job_456",
        scheduleId: "schedule_1",
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
          creditsPrice: { cents: 500 },
        } as never,
        inputSchema: [] as never,
        demoValues: null,
        scheduleSelection: {
          mode: JobScheduleType.NOW,
          timezone: "Europe/Dublin",
        },
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
        maxAcceptedCents: 500,
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

  it("uploads file inputs before creating a schedule", async () => {
    const { result } = renderHook(() =>
      useJobSubmission({
        agent: {
          id: "agent_1",
          creditsPrice: { cents: 500 },
        } as never,
        inputSchema: [] as never,
        demoValues: null,
        scheduleSelection: {
          mode: JobScheduleType.ONE_TIME,
          timezone: "Europe/Dublin",
          oneTimeLocalIso: "2026-04-02T10:00:00",
        },
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

    expect(createScheduleMock).toHaveBeenCalledWith({
      input: {
        agentId: "agent_1",
        inputSchema: [],
        inputData: {
          attachment: "https://blob.example/users/user_123/report.pdf",
        },
        maxAcceptedCents: 500,
      },
      scheduleSelection: {
        mode: JobScheduleType.ONE_TIME,
        timezone: "Europe/Dublin",
        oneTimeLocalIso: "2026-04-02T10:00:00",
      },
    });
    expect(uploadInputDataFilesMock.mock.invocationCallOrder[0]).toBeLessThan(
      createScheduleMock.mock.invocationCallOrder[0],
    );
    expect(pushMock).toHaveBeenCalledWith("/schedules");
  });
});
