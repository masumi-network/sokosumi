import {
  isSokoBotWebEvidence,
  projectSokoBotWebEvidence,
  type RuntimeJsonValue,
} from "@sokosumi/soko-bot";
import { sanitizePersistedValue, truncateUtf8 } from "./persisted-value";

const LEGACY_OUTPUT_MAX_BYTES = 12_288;

/** New web runners send complete projection JSON; old runners remain readable. */
export function sandboxActionEvidence(input: {
  name: string;
  output?: string;
  sources?: string[];
}): {
  output: RuntimeJsonValue;
  sources: RuntimeJsonValue;
  evidenceVisibility?: RuntimeJsonValue;
} {
  const web = input.name === "web_fetch" || input.name === "web_search";
  if (web && input.output !== undefined) {
    try {
      const parsed: unknown = JSON.parse(input.output);
      if (isSokoBotWebEvidence(parsed)) {
        const result = projectSokoBotWebEvidence(parsed);
        // Re-project untrusted input once. A second generic redaction pass
        // counts envelope nesting and would shorten only the audit's view.
        return { output: { ...result }, sources: result.sources };
      }
    } catch {
      // A legacy runner may have clipped JSON mid-value. Never label it complete.
    }
  }
  const output =
    input.output === undefined
      ? null
      : truncateUtf8(input.output, LEGACY_OUTPUT_MAX_BYTES);
  return {
    output: sanitizePersistedValue(output),
    sources: sanitizePersistedValue(input.sources ?? []),
    ...(web
      ? {
          evidenceVisibility: {
            complete: false,
            reasons: ["legacy_web_output"],
          },
        }
      : {}),
  };
}
