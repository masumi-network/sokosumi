import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getEnvMock } = vi.hoisted(() => ({ getEnvMock: vi.fn() }));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));

import {
  configuredFfmpegBuild,
  DEFAULT_FFMPEG_BUILD,
  fetchFfmpeg,
} from "./media";

const binary = Buffer.from("#!/bin/sh\necho ffmpeg\n");
const gz = gzipSync(binary);
const build = {
  url: "https://example.test/ffmpeg-linux-x64.gz",
  sha256: createHash("sha256").update(gz).digest("hex"),
};

let dir: string;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ffmpeg-fetch-test-"));
  fetchMock = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array(gz).buffer,
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("fetchFfmpeg", () => {
  it("unpacks the pinned build as an executable, once", async () => {
    const target = await fetchFfmpeg(build, dir);

    expect(readFileSync(target)).toEqual(binary);
    expect(statSync(target).mode & 0o111).not.toBe(0);
    expect(await fetchFfmpeg(build, dir)).toBe(target);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses bytes that do not match the pinned hash", async () => {
    await expect(
      fetchFfmpeg({ ...build, sha256: "0".repeat(64) }, dir),
    ).rejects.toThrow(/pinned hash/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("fails on a bad response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });

    await expect(fetchFfmpeg(build, dir)).rejects.toThrow(/503/);
  });
});

describe("configuredFfmpegBuild", () => {
  it("defaults to the pinned release", () => {
    getEnvMock.mockReturnValue({});

    expect(configuredFfmpegBuild()).toEqual(DEFAULT_FFMPEG_BUILD);
  });

  it("uses the configured source and its hash", () => {
    getEnvMock.mockReturnValue({
      AVATAR_FFMPEG_URL: "https://blob.test/ffmpeg.gz",
      AVATAR_FFMPEG_SHA256: "b".repeat(64),
    });

    expect(configuredFfmpegBuild()).toEqual({
      url: "https://blob.test/ffmpeg.gz",
      sha256: "b".repeat(64),
    });
  });

  it("never pairs a configured URL with the pinned hash", () => {
    getEnvMock.mockReturnValue({ AVATAR_FFMPEG_URL: "https://blob.test/f.gz" });

    expect(configuredFfmpegBuild()).toEqual(DEFAULT_FFMPEG_BUILD);
  });
});
