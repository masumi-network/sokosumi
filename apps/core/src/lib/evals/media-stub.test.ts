import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  EVAL_STUB_REQUEST_PREFIX,
  EVAL_STUB_SOURCE,
  isEvalStubRequest,
  isEvalStubSource,
  stubImage,
  stubVideo,
} from "./media-stub";

describe("the benchmark media stub", () => {
  it("makes the same 1024x1024 PNG for the same job, another for another job", async () => {
    const first = await stubImage("job-1");
    const again = await stubImage("job-1");
    const other = await stubImage("job-2");
    expect(first.contentType).toBe("image/png");
    expect(Buffer.from(first.bytes).equals(Buffer.from(again.bytes))).toBe(
      true,
    );
    expect(Buffer.from(first.bytes).equals(Buffer.from(other.bytes))).toBe(
      false,
    );
    const meta = await sharp(first.bytes).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1024, 1024, "png"]);
  });

  // Core finds ffmpeg itself on Linux x64 (CI, Vercel); elsewhere through FFMPEG_PATH.
  it.skipIf(
    !(process.platform === "linux" && process.arch === "x64") &&
      !process.env.FFMPEG_PATH,
  )(
    "makes a playable MP4 for a video job",
    async () => {
      const video = await stubVideo();
      expect(video.contentType).toBe("video/mp4");
      expect(Buffer.from(video.bytes.subarray(4, 8)).toString("ascii")).toBe(
        "ftyp",
      );
    },
    30_000,
  );

  it("recognises only its own request ids and source", () => {
    expect(isEvalStubRequest(`${EVAL_STUB_REQUEST_PREFIX}job-1`)).toBe(true);
    expect(isEvalStubRequest("fal-123")).toBe(false);
    expect(isEvalStubRequest(null)).toBe(false);
    expect(isEvalStubSource(EVAL_STUB_SOURCE)).toBe(true);
    expect(isEvalStubSource("https://v3.fal.media/files/x.png")).toBe(false);
  });
});
