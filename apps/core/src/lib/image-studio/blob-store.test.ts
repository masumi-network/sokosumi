import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getEnvMock, putMock, getMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  putMock: vi.fn(),
  getMock: vi.fn(),
}));
vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@vercel/blob", () => ({ put: putMock, get: getMock }));

import { readStudioBlobToken, studioGet, studioPut } from "./blob-store";

describe("the studio store on a local eval run", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "studio-store-"));
    getEnvMock.mockReturnValue({ EVAL_LOCAL_STUDIO_STORE_DIR: dir });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps and returns the bytes in the local directory, never Vercel Blob", async () => {
    const token = readStudioBlobToken();
    expect(token).toBeDefined();
    await studioPut("projects/p/image-studio/j-1", new Uint8Array([1, 2, 3]), {
      access: "private",
      token,
      contentType: "image/png",
    });
    const got = await studioGet("projects/p/image-studio/j-1", {
      access: "private",
      token,
    });
    expect(got?.statusCode).toBe(200);
    expect(got?.blob.contentType).toBe("image/png");
    expect(
      new Uint8Array(await new Response(got?.stream).arrayBuffer()),
    ).toEqual(new Uint8Array([1, 2, 3]));
    expect(putMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });

  it("refuses a pathname that leaves the directory", async () => {
    await expect(
      studioPut("../outside", new Uint8Array([1]), {
        access: "private",
        token: readStudioBlobToken(),
      }),
    ).rejects.toThrow(/escapes/);
  });

  it("is off on Vercel and when a real private store is configured", () => {
    vi.stubEnv("VERCEL", "1");
    expect(readStudioBlobToken()).toBeUndefined();
    vi.unstubAllEnvs();
    getEnvMock.mockReturnValue({
      EVAL_LOCAL_STUDIO_STORE_DIR: dir,
      IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_real",
    });
    expect(readStudioBlobToken()).toBe("vercel_blob_rw_real");
  });
});
