import {
  projectSokoBotWebEvidence,
  redactSokoBotSensitiveText,
  type SokoBotWebEvidence,
} from "@sokosumi/soko-bot";

/** Share the same web projection across both runtimes and their audit rows. */
export async function runWebEvidenceTool(input: {
  run: () => Promise<unknown>;
  sources: (value: unknown) => string[];
  report: (
    status: "completed" | "failed",
    output: string,
    sources: string[],
  ) => Promise<unknown>;
}): Promise<SokoBotWebEvidence> {
  try {
    const raw = await input.run();
    const result = projectSokoBotWebEvidence(raw, input.sources(raw));
    await input.report("completed", JSON.stringify(result), result.sources);
    return result;
  } catch (error) {
    const message = redactSokoBotSensitiveText(
      error instanceof Error ? error.message : "Web request failed",
    );
    try {
      await input.report("failed", JSON.stringify({ error: message }), []);
    } catch {
      // Keep reporting failures behind the same redaction boundary.
    }
    const safeError = new Error(message);
    safeError.name =
      error instanceof Error ? redactSokoBotSensitiveText(error.name) : "Error";
    throw safeError;
  }
}
