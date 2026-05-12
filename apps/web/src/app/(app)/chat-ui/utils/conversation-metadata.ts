import type { UIMessage } from "ai";

/** Matches `ACTIVE_UI_STREAM_ID_METADATA_KEY` in core (`active_ui_stream_id`). */
export function readActiveUiStreamIdFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const v = metadata?.active_ui_stream_id;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export function readPendingResponsesApiResponseIdFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | undefined {
  const p = metadata?.pending_responses_api_response_id;
  return typeof p === "string" && p.trim().length > 0 ? p.trim() : undefined;
}

export function readConversationImageGenerationFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return metadata?.image_generation === true;
}

export function readImageGenerationFromUiMessage(message: UIMessage): boolean {
  const metadata = (message as { metadata?: unknown }).metadata;
  return (
    message.role === "user" &&
    metadata != null &&
    typeof metadata === "object" &&
    (metadata as Record<string, unknown>).imageGeneration === true
  );
}

export function hasImageGenerationUiMessage(messages: UIMessage[]): boolean {
  return messages.some(readImageGenerationFromUiMessage);
}
