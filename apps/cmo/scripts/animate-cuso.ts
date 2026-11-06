/**
 * Turns Cuso's stills in `public/cuso/` into short loops: Seedance 2.5 on the
 * AI Gateway animates each still with the still as its first and last frame,
 * so a clip starts and ends on its poster, and ffmpeg encodes a small H.264
 * MP4 beside it. Nothing runs at build or request time; run it when a still or
 * a prompt changes, then commit the MP4s (see AGENTS.md → Cuso's animations).
 *
 *   node --env-file=../core/.env scripts/animate-cuso.ts [name ...] [--reencode]
 *
 * Names pick clips (default: all). `--reencode` skips Seedance and encodes the
 * raw clips kept from the last run, to tune ffmpeg without paying again.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGateway, experimental_generateVideo } from "ai";

const MODEL = "bytedance/seedance-2.5";
const CUSO_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/cuso",
);
const RAW_DIR = path.join(tmpdir(), "cmo-cuso-raw");
/** `--stage` in globals.css: the poses' transparent PNGs sit on it. */
const STAGE = "0xF5F5F5";
/**
 * Gateway caps async request bodies at 300 KiB and the still goes twice
 * (first and last frame), so each copy must stay well under half of that.
 */
const MAX_FRAME_BYTES = 100_000;

const LOOP =
  "Static camera, no zoom, pan or cut. The background and framing stay exactly the same. " +
  "Gentle, smooth motion that ends exactly in the starting pose, for a seamless loop. " +
  "No text, no new objects, no extra characters.";

interface Clip {
  /** The still in public/cuso/; the MP4 takes its base name. */
  still: string;
  prompt: string;
  /** Encoded width in px: about twice the largest size it is shown at. */
  width: number;
  /** Seconds. */
  duration: number;
}

const CUSO =
  "Cuso, a white 3D cursor-arrow mascot with a thick black outline, small eyes, black arms and white sneakers,";

const CLIPS: Clip[] = [
  {
    still: "reading.png",
    prompt: `${CUSO} slowly moves his magnifying glass a little left and right as if reading, and blinks once. His feet stay planted. ${LOOP}`,
    width: 256,
    duration: 4,
  },
  {
    still: "thinking.png",
    prompt: `${CUSO} taps his chin twice while thinking, the question mark above him bobs gently, and he blinks once. His feet stay planted. ${LOOP}`,
    width: 256,
    duration: 4,
  },
  {
    still: "needs-you.png",
    prompt: `${CUSO} waves his raised hand to get attention, the small marks beside his hand pulse, and he blinks once. His feet stay planted. ${LOOP}`,
    width: 256,
    duration: 4,
  },
  {
    still: "reporting.png",
    prompt: `${CUSO} lifts his chart card slightly and the bars on it grow up one by one, then he blinks once. His feet stay planted. ${LOOP}`,
    width: 256,
    duration: 4,
  },
  {
    still: "done.png",
    prompt: `${CUSO} nods once with a happy wink, and the green check badge in his hand gives one small bounce. His feet stay planted. ${LOOP}`,
    width: 256,
    duration: 4,
  },
  {
    still: "hero.jpg",
    prompt: `${CUSO} walks in place on the pink round podium, swinging his arms, and lifts his megaphone to shout once. The pink backdrop stays plain. ${LOOP}`,
    width: 720,
    duration: 5,
  },
  {
    still: "reading-scene.jpg",
    prompt: `${CUSO} moves his big magnifying glass slowly across the browser window beside him as if reading it, and blinks once. The window stays still. ${LOOP}`,
    width: 384,
    duration: 5,
  },
  {
    still: "celebration.jpg",
    prompt: `${CUSO} does a small happy jump with both fists up, the confetti flutters down, and the toy rocket's flame flickers. ${LOOP}`,
    width: 640,
    duration: 5,
  },
];

function run(args: string[]): void {
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
}

function baseName(clip: Clip): string {
  return clip.still.replace(/\.\w+$/, "");
}

/** The still as a JPEG frame: PNGs flattened on the stage, small enough to send twice. */
function frame(clip: Clip): Buffer {
  const out = path.join(RAW_DIR, `${baseName(clip)}-frame.jpg`);
  const input = path.join(CUSO_DIR, clip.still);
  if (clip.still.endsWith(".png")) {
    run([
      "-f",
      "lavfi",
      "-i",
      `color=${STAGE}:s=512x512`,
      "-i",
      input,
      "-filter_complex",
      "[1]scale=512:512[c];[0][c]overlay=format=auto",
      "-frames:v",
      "1",
      "-q:v",
      "3",
      out,
    ]);
  } else {
    run(["-i", input, "-frames:v", "1", "-q:v", "4", out]);
  }
  const bytes = readFileSync(out);
  if (bytes.length > MAX_FRAME_BYTES) {
    throw new Error(`${clip.still}: frame is ${bytes.length} bytes`);
  }
  return bytes;
}

async function generate(clip: Clip, apiKey: string): Promise<string> {
  const raw = path.join(RAW_DIR, `${baseName(clip)}.mp4`);
  const image = frame(clip);
  const { video } = await experimental_generateVideo({
    model: createGateway({ apiKey }).videoModel(MODEL),
    prompt: clip.prompt,
    // First-and-last-frame mode takes the ratio from the frame; any other value is refused.
    aspectRatio: "adaptive",
    // Seedance wants "720p"; the SDK types it as WxH (as in Core's avatar loop).
    resolution: "720p" as `${number}x${number}`,
    duration: clip.duration,
    generateAudio: false,
    frameImages: [
      { image, frameType: "first_frame" },
      { image, frameType: "last_frame" },
    ],
    maxRetries: 0,
    poll: { timeoutMs: 15 * 60_000 },
  });
  writeFileSync(raw, video.uint8Array);
  return raw;
}

/** Web MP4: H.264 yuv420p, no audio, moov first, about 2x the shown size. */
function encode(clip: Clip, raw: string): string {
  const out = path.join(CUSO_DIR, `${baseName(clip)}.mp4`);
  run([
    "-i",
    raw,
    "-an",
    "-vf",
    `scale=${clip.width}:-2:flags=lanczos,fps=24,format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "veryslow",
    "-crf",
    "28",
    "-profile:v",
    "high",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-colorspace",
    "bt709",
    "-movflags",
    "+faststart",
    out,
  ]);
  return out;
}

const args = process.argv.slice(2);
const reencode = args.includes("--reencode");
const names = args.filter((arg) => !arg.startsWith("--"));
const clips = names.length
  ? CLIPS.filter((clip) => names.includes(baseName(clip)))
  : CLIPS;
if (clips.length === 0) {
  throw new Error(`No clip named ${names.join(", ")}`);
}

const apiKey = process.env.AI_GATEWAY_API_KEY;
if (!reencode && !apiKey) {
  throw new Error(
    "AI_GATEWAY_API_KEY is not set (run with --env-file=../core/.env)",
  );
}
mkdirSync(RAW_DIR, { recursive: true });

const results = await Promise.allSettled(
  clips.map(async (clip) => {
    const raw = reencode
      ? path.join(RAW_DIR, `${baseName(clip)}.mp4`)
      : await generate(clip, apiKey ?? "");
    if (!existsSync(raw)) throw new Error(`no raw clip at ${raw}`);
    const out = encode(clip, raw);
    return `${path.basename(out)} ${Math.round(readFileSync(out).length / 1024)} KB`;
  }),
);

let failed = 0;
results.forEach((result, index) => {
  const name = clips[index]?.still;
  if (result.status === "fulfilled") {
    console.log(`ok   ${result.value}`);
  } else {
    failed += 1;
    const reason = result.reason;
    console.error(
      `fail ${name}: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
  }
});
console.log(`Raw clips kept in ${RAW_DIR}`);
if (failed > 0) process.exitCode = 1;
