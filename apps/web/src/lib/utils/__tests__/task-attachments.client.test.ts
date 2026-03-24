import { beforeEach, describe, expect, it, vi } from "vitest";

import { uploadTaskAttachment } from "@/lib/utils/task-attachments.client";

const uploadMyFileMock = vi.fn();

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    uploadMyFile: (...args: unknown[]) => uploadMyFileMock(...args),
  },
}));

describe("task-attachments.client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploads task attachments through the Core browser client", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });

    uploadMyFileMock.mockResolvedValue({
      data: {
        publicUrl: "https://blob.example/users/user_123/report.pdf",
      },
    });

    await expect(uploadTaskAttachment(file)).resolves.toBe(
      "https://blob.example/users/user_123/report.pdf",
    );
    expect(uploadMyFileMock).toHaveBeenCalledWith(file);
  });

  it("throws a generic error when the Core upload fails", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });

    uploadMyFileMock.mockRejectedValue(new Error("Unauthorized"));

    await expect(uploadTaskAttachment(file)).rejects.toThrow(
      "Failed to upload file",
    );
  });
});
