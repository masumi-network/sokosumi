import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const uploadFileForUserMock = vi.fn();

vi.mock("@/lib/blob/utils", () => ({
  uploadFileForUser: (...args: unknown[]) => uploadFileForUserMock(...args),
}));

import { handleInputDataFileUploads } from "@/lib/actions/job/utils";

describe("handleInputDataFileUploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replaces a single file input with a URL", async () => {
    const inputData = {
      document: new File(["hello"], "hello.txt", { type: "text/plain" }),
    };
    uploadFileForUserMock.mockResolvedValueOnce({
      url: "https://files.example/hello.txt",
    });

    const result = await handleInputDataFileUploads("user_1", inputData);

    expect(result).toBeUndefined();
    expect(uploadFileForUserMock).toHaveBeenCalledTimes(1);
    expect(uploadFileForUserMock).toHaveBeenCalledWith(
      "user_1",
      expect.any(File),
    );
    expect(inputData.document).toBe("https://files.example/hello.txt");
  });

  it("replaces multiple file inputs with URL array", async () => {
    const inputData = {
      files: [
        new File(["first"], "first.pdf", { type: "application/pdf" }),
        new File(["second"], "second.pdf", { type: "application/pdf" }),
      ],
    };
    uploadFileForUserMock
      .mockResolvedValueOnce({
        url: "https://files.example/first.pdf",
      })
      .mockResolvedValueOnce({
        url: "https://files.example/second.pdf",
      });

    await handleInputDataFileUploads("user_2", inputData);

    expect(uploadFileForUserMock).toHaveBeenCalledTimes(2);
    expect(inputData.files).toEqual([
      "https://files.example/first.pdf",
      "https://files.example/second.pdf",
    ]);
  });
});
