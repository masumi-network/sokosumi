export function readPendingResponsesApiResponseIdFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | undefined {
  const p = metadata?.pending_responses_api_response_id;
  return typeof p === "string" && p.trim().length > 0 ? p.trim() : undefined;
}
