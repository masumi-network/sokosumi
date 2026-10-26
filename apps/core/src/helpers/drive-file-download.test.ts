import { SsrfError } from "@sokosumi/net";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DriveFileDownloadError,
  downloadDriveFile,
} from "@/helpers/drive-file-download";

const { ssrfSafeFetchMock } = vi.hoisted(() => ({
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

const URL_ = "https://store.public.blob.vercel-storage.com/drive/users/u/a.png";
const options = {
  maxBytes: 4,
  timeoutMs: 1000,
  acceptsMimeType: (mime: string) => mime === "image/png",
};

function response(body: number[] | null, type: string | null, status = 200) {
  const headers = new Headers();
  if (type) headers.set("content-type", type);
  return new Response(body && new Uint8Array(body), { status, headers });
}

describe("downloadDriveFile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns the bytes and the served MIME type without parameters", async () => {
    ssrfSafeFetchMock.mockResolvedValue(
      response([1, 2], "Image/PNG; charset=binary"),
    );
    await expect(downloadDriveFile(URL_, options)).resolves.toEqual({
      bytes: new Uint8Array([1, 2]),
      mimeType: "image/png",
    });
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      URL_,
      expect.objectContaining({ maxResponseBytes: 4 }),
    );
  });

  it("aborts with the caller's signal", async () => {
    const controller = new AbortController();
    ssrfSafeFetchMock.mockImplementation(
      async (_url: string, init: { signal: AbortSignal }) => {
        controller.abort();
        expect(init.signal.aborted).toBe(true);
        return response([1], "image/png");
      },
    );
    await downloadDriveFile(URL_, { ...options, signal: controller.signal });
    expect(ssrfSafeFetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "the guard reports the cap",
      () =>
        ssrfSafeFetchMock.mockRejectedValue(
          new SsrfError("Response body exceeds maxResponseBytes (4)"),
        ),
      "too_large",
    ],
    [
      "the bytes exceed the cap",
      () =>
        ssrfSafeFetchMock.mockResolvedValue(
          response([1, 2, 3, 4, 5], "image/png"),
        ),
      "too_large",
    ],
    [
      "the file is gone",
      () => ssrfSafeFetchMock.mockResolvedValue(response(null, null, 404)),
      "unavailable",
    ],
    [
      "the served type is not accepted",
      () => ssrfSafeFetchMock.mockResolvedValue(response([1], "text/html")),
      "wrong_type",
    ],
    [
      "no type is served",
      () => ssrfSafeFetchMock.mockResolvedValue(response([1], null)),
      "wrong_type",
    ],
  ])("raises %s as %s", async (_label, arrange, reason) => {
    arrange();
    await expect(downloadDriveFile(URL_, options)).rejects.toMatchObject({
      name: "DriveFileDownloadError",
      reason,
    });
  });

  it("is a DriveFileDownloadError", async () => {
    ssrfSafeFetchMock.mockResolvedValue(response(null, null, 404));
    await expect(downloadDriveFile(URL_, options)).rejects.toBeInstanceOf(
      DriveFileDownloadError,
    );
  });

  it("rethrows other failures unchanged", async () => {
    const blocked = new SsrfError("blocked host");
    ssrfSafeFetchMock.mockRejectedValue(blocked);
    await expect(downloadDriveFile(URL_, options)).rejects.toBe(blocked);
  });
});
