/**
 * The owner benchmark's marketplace Agent (prepare "agent"). Its host is under
 * `.invalid`, which never resolves; in an eval workspace Core answers the
 * Agent's input-schema request in process, so a journey can look the Agent
 * up, read what it needs and quote its price the same way every run. Hiring
 * it is never answered here: a benchmark journey that hires fails on its own
 * checks first.
 */
export const EVAL_AGENT_BASE_URL = "https://agent.evals.invalid";

export function isEvalAgentBaseUrl(
  baseURL: string | null | undefined,
): boolean {
  return baseURL?.trim() === EVAL_AGENT_BASE_URL;
}

/** What the eval Agent asks for: one free-text request. */
export const EVAL_AGENT_INPUT_SCHEMA = {
  input_data: [
    {
      id: "request",
      type: "string",
      name: "What to collect",
      data: {
        description:
          "Describe what to collect: the area or the companies, and which fields you need.",
      },
    },
  ],
};
