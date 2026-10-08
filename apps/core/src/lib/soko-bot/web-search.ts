import {
  type createGateway,
  generateText,
  type LanguageModel,
  stepCountIs,
} from "ai";

type Gateway = Pick<ReturnType<typeof createGateway>, "tools">;

/**
 * One web search, in its own model call. The Gateway runs the search inside
 * that call; keeping it out of the main conversation matters because Gemini
 * rejects a replayed history that mixes Gateway-executed and runner-executed
 * tool calls in one step. The key must not be `web_search`: OpenAI models map
 * that name to their own built-in tool and reject the call. Shared by the
 * sandbox runner and Core's in-process runtime.
 */
export async function searchWeb(
  query: string,
  gateway: Gateway,
  model: LanguageModel,
): Promise<{ query: string; results: unknown[] }> {
  const result = await generateText({
    model,
    tools: {
      perplexity_search: gateway.tools.perplexitySearch({ maxResults: 5 }),
    },
    toolChoice: { type: "tool", toolName: "perplexity_search" },
    stopWhen: stepCountIs(1),
    prompt: `Search the web for: ${query}`,
  });
  return {
    query,
    results: result.steps.flatMap((step) =>
      step.content.flatMap((part) =>
        part.type === "tool-result" ? [part.output] : [],
      ),
    ),
  };
}
