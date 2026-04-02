import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const provideJobInputMock = vi.fn();
const uploadInputDataFilesMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const refreshMock = vi.fn();
const onSuccessMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: (...args: unknown[]) => refreshMock(...args),
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
    BAD_INPUT: "BAD_INPUT",
  },
}));

vi.mock("@/lib/actions/job/action", () => ({
  provideJobInput: (...args: unknown[]) => provideJobInputMock(...args),
}));

vi.mock("@/lib/utils/user-file-upload.client", () => ({
  getUserFileUploadErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
  uploadInputDataFiles: (...args: unknown[]) =>
    uploadInputDataFilesMock(...args),
}));

import { useProvideJobInput } from "@/hooks/use-provide-job-input";

describe("useProvideJobInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadInputDataFilesMock.mockImplementation(async (inputData) => {
      if (
        inputData &&
        typeof inputData === "object" &&
        "attachment" in inputData
      ) {
        inputData.attachment = "https://blob.example/users/user_123/report.pdf";
      }
    });
    provideJobInputMock.mockResolvedValue({
      ok: true,
      data: {
        jobId: "job_123",
      },
    });
  });

  it("uploads file inputs before providing job input", async () => {
    const { result } = renderHook(() =>
      useProvideJobInput({
        jobId: "job_123",
        eventId: "event_123",
        readonlyInputValues: {
          readonlyField: "readonly value",
        },
        inputFieldIdsInOrder: ["attachment", "readonlyField"],
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
    expect(provideJobInputMock).toHaveBeenCalledWith({
      input: {
        jobId: "job_123",
        eventId: "event_123",
        inputData: {
          attachment: "https://blob.example/users/user_123/report.pdf",
          readonlyField: "readonly value",
        },
      },
    });
    expect(uploadInputDataFilesMock.mock.invocationCallOrder[0]).toBeLessThan(
      provideJobInputMock.mock.invocationCallOrder[0],
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("submitSuccess");
    expect(onSuccessMock).toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalled();
  });
});
