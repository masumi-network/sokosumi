/**
 * A voice message's transcript lives in the message content as a fenced
 * block with the info string `transcript`, after the audio link. It is plain
 * message text, so room search, edit rights and read access are the message's
 * own. A client that does not know the fence shows it as a code block.
 */
const TRANSCRIPT_FENCE =
  /(?:^|\n)[ \t]*(`{3,})transcript[ \t]*\n([\s\S]*?)\n[ \t]*\1[ \t]*(?=\n|$)/;

export function splitVoiceTranscript(content: string): {
  content: string;
  transcript: string | null;
} {
  const match = TRANSCRIPT_FENCE.exec(content);
  if (!match) return { content, transcript: null };
  return {
    content: (
      content.slice(0, match.index) +
      content.slice(match.index + match[0].length)
    ).trimEnd(),
    transcript: match[2].trim() || null,
  };
}

/** Replaces the transcript; an empty one removes it. */
export function setVoiceTranscript(
  content: string,
  transcript: string,
): string {
  const body = splitVoiceTranscript(content).content;
  const text = transcript.trim();
  if (!text) return body;
  // A fence longer than any backtick run in the text, so the text cannot close it.
  const longestRun = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${body}\n\n${fence}transcript\n${text}\n${fence}`;
}

/**
 * Loudness per bar, 0..1, from decoded samples: the peak of each slice,
 * scaled so the loudest bar is 1. Silence stays 0.
 */
export function voiceWaveformPeaks(
  samples: Float32Array,
  bars: number,
): number[] {
  if (samples.length === 0 || bars <= 0) return [];
  const peaks: number[] = [];
  const step = samples.length / bars;
  for (let bar = 0; bar < bars; bar++) {
    let peak = 0;
    const end = Math.min(samples.length, Math.floor((bar + 1) * step));
    for (let i = Math.floor(bar * step); i < end; i++) {
      const value = Math.abs(samples[i] ?? 0);
      if (value > peak) peak = value;
    }
    peaks.push(peak);
  }
  const loudest = Math.max(...peaks);
  return loudest > 0 ? peaks.map((peak) => peak / loudest) : peaks;
}

/**
 * The body, or null once it passes `maxBytes`. Counts while streaming, so a
 * missing or wrong `content-length` cannot make the page read more.
 */
export async function readAtMost(
  response: Response,
  maxBytes: number,
): Promise<ArrayBuffer | null> {
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}
