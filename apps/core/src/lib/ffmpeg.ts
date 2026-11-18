import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { getEnv } from "@/config/env";

interface PinnedFile {
  url: string;
  sha256: string;
}

/**
 * The linux-x64 build of ffmpeg-static b6.1.1, with libass and libx264, as
 * our copy in the public mainnet Blob store. The deployed function does not
 * ship it: 80 MB unzipped for a step that runs once per talking video.
 */
const FFMPEG_BUILD: PinnedFile = {
  url: "https://igcd4cnfvuav1zto.public.blob.vercel-storage.com/vendor/ffmpeg-static/b6.1.1/ffmpeg-linux-x64.gz",
  sha256: "bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa",
};

/** Montserrat Black (SIL Open Font License), the caption typeface. */
const CAPTION_FONT: PinnedFile = {
  url: "https://igcd4cnfvuav1zto.public.blob.vercel-storage.com/vendor/fonts/Montserrat-Black.ttf",
  sha256: "ea67b37f8776eebea135cd1fe9adeaf6f9427683e8dc11ab8398b6be5f102c60",
};
export const CAPTION_FONT_FAMILY = "Montserrat Black";

const DOWNLOAD_TIMEOUT_MS = 60_000;

/** Fetches a pinned file once per instance and returns its verified bytes. */
async function fetchPinned(file: PinnedFile): Promise<Buffer> {
  const response = await fetch(file.url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`Download of ${file.url} failed (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
    throw new Error(`${file.url} does not match its pinned hash`);
  return bytes;
}

/** Writes `bytes` to `target` by rename, so a concurrent run never sees half a file. */
async function writeOnce(
  target: string,
  bytes: Buffer,
  mode: number,
): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const partial = `${target}.${randomUUID()}`;
  await writeFile(partial, bytes, { mode });
  await rename(partial, target);
}

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}

/** `FFMPEG_PATH` when set (local machines), else the pinned build (Vercel). */
const ffmpegBinary = once(async () => {
  const local = getEnv().FFMPEG_PATH;
  if (local) return local;
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("Set FFMPEG_PATH to an ffmpeg built with libass.");
  const target = path.join(
    tmpdir(),
    `ffmpeg-${FFMPEG_BUILD.sha256.slice(0, 16)}`,
  );
  if (!existsSync(target))
    await writeOnce(target, gunzipSync(await fetchPinned(FFMPEG_BUILD)), 0o755);
  return target;
});

/** A directory holding the caption font, for libass's `fontsdir`. */
export const captionFontsDir = once(async () => {
  const dir = path.join(
    tmpdir(),
    `caption-fonts-${CAPTION_FONT.sha256.slice(0, 16)}`,
  );
  const target = path.join(dir, "Montserrat-Black.ttf");
  if (!existsSync(target))
    await writeOnce(target, await fetchPinned(CAPTION_FONT), 0o644);
  return dir;
});

/** Runs ffmpeg and rejects with the end of its error output when it fails. */
export async function runFfmpeg(
  args: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<void> {
  const binary = await ffmpegBinary();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ["-v", "error", "-nostdin", "-y", ...args], {
      cwd: options.cwd,
      stdio: ["ignore", "ignore", "pipe"],
      timeout: options.timeoutMs,
    });
    const errors: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `ffmpeg exited with ${code}: ${Buffer.concat(errors).toString().slice(-400)}`,
            ),
          ),
    );
  });
}
