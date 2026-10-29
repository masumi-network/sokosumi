import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import ffmpegPath from "ffmpeg-static";

/** Stills are stored at this size; the studio shows them at 560 px. */
export const STILL_SIZE = 640;
export const LOOP_SIZES = [320, 560] as const;

const EDGE_RING = 8;
const MIN_GAIN = 0.85;
const MAX_GAIN = 1.3;
const FFMPEG_TIMEOUT_MS = 90_000;

function run(args: string[], input?: Buffer): Promise<Buffer> {
  const binary = ffmpegPath;
  if (!binary) return Promise.reject(new Error("ffmpeg is not available"));
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["-v", "error", "-y", ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: FFMPEG_TIMEOUT_MS,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    // Writing to a process that already exited raises EPIPE; the exit code
    // below carries the real reason.
    child.stdin.on("error", () => {});
    child.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(out))
        : reject(
            new Error(
              `ffmpeg exited with ${code}: ${Buffer.concat(err).toString().slice(0, 300)}`,
            ),
          ),
    );
    child.stdin.end(input);
  });
}

/**
 * Per-channel gain that pulls the background to `target`. The background is
 * read as the median of an 8 px ring along the image edge, so a subject that
 * stays inside the frame cannot move it.
 */
function levelGains(rgb: Buffer, size: number, target: number): number[] {
  const histograms = [0, 1, 2].map(() => new Uint32Array(256));
  let samples = 0;
  for (let y = 0; y < size; y += 1) {
    const onEdgeRow = y < EDGE_RING || y >= size - EDGE_RING;
    for (let x = 0; x < size; x += 1) {
      if (!onEdgeRow && x >= EDGE_RING && x < size - EDGE_RING) {
        // Skip the interior in one step.
        x = size - EDGE_RING - 1;
        continue;
      }
      const at = (y * size + x) * 3;
      for (let c = 0; c < 3; c += 1) histograms[c]![rgb[at + c]!]! += 1;
      samples += 1;
    }
  }
  return histograms.map((histogram) => {
    let seen = 0;
    let median = 0;
    for (; median < 255; median += 1) {
      seen += histogram[median]!;
      if (seen * 2 >= samples) break;
    }
    return Math.min(MAX_GAIN, Math.max(MIN_GAIN, target / Math.max(1, median)));
  });
}

/** An ffmpeg filter that scales each channel; `+0.5` rounds like the spike did. */
function gainFilter(gains: number[]): string {
  const [r, g, b] = gains.map((gain) => gain.toFixed(4));
  return `lutrgb=r='clip(val*${r}+0.5,0,255)':g='clip(val*${g}+0.5,0,255)':b='clip(val*${b}+0.5,0,255)'`;
}

async function gainsFor(
  input: Buffer,
  size: number,
  target: number,
): Promise<number[]> {
  const rgb = await run(
    [
      "-i",
      "pipe:0",
      "-frames:v",
      "1",
      "-vf",
      `scale=${size}:${size}:flags=lanczos`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    input,
  );
  return levelGains(rgb, size, target);
}

/**
 * Brand neutral: square the image to 640 px and scale each channel so the
 * background lands on `target`, clamped to 0.85-1.3. Returns a WebP.
 */
export async function levelStill(
  input: Buffer,
  target: number,
): Promise<Buffer> {
  const gains = await gainsFor(input, STILL_SIZE, target);
  return await run(
    [
      "-i",
      "pipe:0",
      "-frames:v",
      "1",
      "-vf",
      `scale=${STILL_SIZE}:${STILL_SIZE}:flags=lanczos,${gainFilter(gains)}`,
      "-c:v",
      "libwebp",
      "-quality",
      "88",
      "-f",
      "webp",
      "pipe:1",
    ],
    input,
  );
}

/**
 * A video drifts off the still's levels, so the gain is read from its first
 * frame and applied to every frame. Encoded as looping animated WebP at both
 * loop sizes.
 */
export async function encodeLoops(
  video: Buffer,
  target: number,
): Promise<{ loop: Buffer; loopLarge: Buffer }> {
  const dir = await mkdtemp(path.join(tmpdir(), "soko-bot-loop-"));
  try {
    const source = path.join(dir, "source.mp4");
    await writeFile(source, video);
    // The container may keep its index at the end, so read it from a file.
    const first = await run([
      "-i",
      source,
      "-frames:v",
      "1",
      "-vf",
      `scale=${STILL_SIZE}:${STILL_SIZE}:flags=lanczos`,
      "-f",
      "image2pipe",
      "-c:v",
      "png",
      "pipe:1",
    ]);
    const lut = gainFilter(await gainsFor(first, STILL_SIZE, target));
    const [small, large] = await Promise.all(
      LOOP_SIZES.map(async (size) => {
        const out = path.join(dir, `loop-${size}.webp`);
        await run([
          "-i",
          source,
          "-an",
          "-vf",
          `${lut},fps=15,scale=${size}:${size}:flags=lanczos`,
          "-c:v",
          "libwebp_anim",
          "-loop",
          "0",
          "-quality",
          "70",
          "-compression_level",
          "6",
          out,
        ]);
        return await readFile(out);
      }),
    );
    return { loop: small!, loopLarge: large! };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const DOWNLOAD_TIMEOUT_MS = 60_000;

/** Bytes of a hosted avatar asset (a still or a finished video). */
export async function downloadAvatarAsset(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`avatar download failed (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}
