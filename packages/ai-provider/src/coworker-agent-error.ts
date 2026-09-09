export const COWORKER_AGENT_ERROR_SNIPPET =
  "Something went wrong while processing your task";

export const COWORKER_AGENT_ERROR_MARKER = "AGENT_ERROR";

export const MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS = 20;

export function coworkerTextLooksLikeAgentError(text: string): boolean {
  return (
    text.includes(COWORKER_AGENT_ERROR_SNIPPET) ||
    text.includes(COWORKER_AGENT_ERROR_MARKER)
  );
}
