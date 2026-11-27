import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { runFfmpeg } from "@/lib/ffmpeg";

/**
 * Benchmark lanes never buy media. The owner benchmark measures the harness,
 * not image quality, so in an eval workspace an image or video job keeps its
 * lifecycle (reserved, queued, settled with an asset) but its "provider" is
 * this stub: deterministic bytes made in process, no paid call. Media the
 * stub can't stand in for (a talking video's voice and lip-sync, a
 * voice-over) fails closed before anything is bought.
 */

/** The request id a stubbed job records instead of fal's. */
export const EVAL_STUB_REQUEST_PREFIX = "eval-stub:";

/** The "media URL" a stubbed job settles with. Never fetched. */
export const EVAL_STUB_SOURCE = "eval-stub://media";

export function isEvalStubSource(url: string): boolean {
  return url === EVAL_STUB_SOURCE;
}

export function isEvalStubRequest(requestId: string | null): boolean {
  return requestId?.startsWith(EVAL_STUB_REQUEST_PREFIX) ?? false;
}

/** Why paid media is refused in a benchmark lane. */
export const BENCHMARK_PAID_MEDIA_REFUSAL =
  "Paid media isn't available in a benchmark lane: this kind has no stub.";

/** A 1024x1024 PNG whose colour comes from `seed`: the same job, the same image. */
export async function stubImage(
  seed: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const [r = 0, g = 0, b = 0] = createHash("sha256").update(seed).digest();
  const bytes = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
  return { bytes: new Uint8Array(bytes), contentType: "image/png" };
}

/** A one-second silent 640x360 black MP4. */
export async function stubVideo(): Promise<{
  bytes: Uint8Array;
  contentType: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "eval-stub-video-"));
  try {
    await runFfmpeg(
      [
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=640x360:d=1:r=24",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "stub.mp4",
      ],
      { cwd: dir, timeoutMs: 30_000 },
    );
    return {
      bytes: new Uint8Array(await readFile(join(dir, "stub.mp4"))),
      contentType: "video/mp4",
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
