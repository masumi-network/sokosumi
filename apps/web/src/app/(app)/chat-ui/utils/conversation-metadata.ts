import type { UIMessage } from "ai";

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
