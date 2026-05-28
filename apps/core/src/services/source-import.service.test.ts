import { beforeEach, describe, expect, it, vi } from "vitest";

import { sourceImportService } from "./source-import.service";

const { captureExceptionMock, upsertLinkMock, upsertOutputBlobMock } =
  vi.hoisted(() => ({
    captureExceptionMock: vi.fn(),
    upsertLinkMock: vi.fn(),
    upsertOutputBlobMock: vi.fn(),
  }));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@sokosumi/database/repositories", () => ({
  blobRepository: {
    upsertOutputBlob: upsertOutputBlobMock,
  },
  linkRepository: {
    upsertLink: upsertLinkMock,
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

describe("sourceImportService.enqueueFromMarkdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts unique file blobs and http links from markdown", async () => {
    await sourceImportService.enqueueFromMarkdown(
      "event_1",
      [
        "[file](https://example.com/result.pdf)",
        "[dup file](https://example.com/result.pdf)",
        "<https://example.com/page>",
        "[link](https://example.com/page)",
        "[skip](mailto:test@example.com)",
      ].join("\n"),
    );

    expect(upsertOutputBlobMock).toHaveBeenCalledTimes(1);
    expect(upsertOutputBlobMock).toHaveBeenCalledWith(
      {
        eventId: "event_1",
        sourceUrl: "https://example.com/result.pdf",
        name: "result.pdf",
      },
      expect.anything(),
    );
    expect(upsertLinkMock).toHaveBeenCalledTimes(1);
    expect(upsertLinkMock).toHaveBeenCalledWith(
      {
        eventId: "event_1",
        url: "https://example.com/page",
        title: undefined,
      },
      expect.anything(),
    );
  });

  it("captures repository errors and continues processing other links", async () => {
    upsertOutputBlobMock.mockRejectedValueOnce(new Error("blob failed"));
    upsertLinkMock.mockRejectedValueOnce(new Error("link failed"));

    await sourceImportService.enqueueFromMarkdown(
      "event_1",
      [
        "[file](https://example.com/result.pdf)",
        "[link](https://example.com/page)",
      ].join("\n"),
    );

    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
    expect(upsertOutputBlobMock).toHaveBeenCalledTimes(1);
    expect(upsertLinkMock).toHaveBeenCalledTimes(1);
  });

  it("skips upserts when markdown contains no importable links", async () => {
    await sourceImportService.enqueueFromMarkdown("event_1", "No links here");

    expect(upsertOutputBlobMock).not.toHaveBeenCalled();
    expect(upsertLinkMock).not.toHaveBeenCalled();
  });
});
