export const COWORKER_AGENT_ERROR_SNIPPET =
  "Something went wrong while processing your task";

export const COWORKER_AGENT_ERROR_RETRY_ATTEMPTS = 5;

export const COWORKER_AGENT_ERROR_RETRY_DELAY_MS = 1000;

export const MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS = 20;

export function coworkerSseBodyLooksLikeAgentError(sseBody: string): boolean {
  return sseBody.includes(COWORKER_AGENT_ERROR_SNIPPET);
}

export function coworkerSseBodyExtractOutputText(sseBody: string): string {
  let text = "";
  for (const line of sseBody.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    try {
      const json = JSON.parse(trimmed.slice(5).trim()) as {
        type?: string;
        delta?: string;
      };
      if (
        json.type === "response.output_text.delta" ||
        json.type === "output_text.delta"
      ) {
        if (typeof json.delta === "string") {
          text += json.delta;
        }
      }
    } catch {
      // skip malformed SSE lines
    }
  }
  return text.trim();
}

export function coworkerSseBodyLooksSuspiciouslyShort(
  sseBody: string,
): boolean {
  if (coworkerSseBodyLooksLikeAgentError(sseBody)) {
    return false;
  }
  const text = coworkerSseBodyExtractOutputText(sseBody);
  return text.length > 0 && text.length < MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
