import { transcribe } from "ai";
import { aiGateway } from "@/lib/ai-gateway-purpose";

/** ElevenLabs Scribe through AI Gateway: detects the language itself. */
export const VOICE_TRANSCRIPTION_MODEL = "elevenlabs/scribe-v2";
/** The composer's formats: MP4 (Safari, recent Chrome) and WebM (Firefox). */
export const VOICE_TRANSCRIPTION_CONTENT_TYPES = ["audio/mp4", "audio/webm"];
/** A two-minute voice message at 128 kbps is about 2 MB. */
export const VOICE_TRANSCRIPTION_MAX_BYTES = 10 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 60_000;

/** What was said, trimmed; empty when nothing was. */
export async function transcribeVoice(audio: Uint8Array): Promise<string> {
  const result = await transcribe({
    model: aiGateway().transcription(VOICE_TRANSCRIPTION_MODEL),
    audio,
    abortSignal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
  });
  return result.text.trim();
}
