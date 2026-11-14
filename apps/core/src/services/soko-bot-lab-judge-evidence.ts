import { isSokoBotWebEvidence } from "@sokosumi/soko-bot";

export const JUDGE_EVIDENCE_VISIBILITY_GUIDANCE =
  "Each tool call includes evidenceVisibility. When matchesModelView is true, the shown web result is exactly what the assistant received: content removed by its redaction or truncation was unavailable to the assistant too and cannot support its claims. Check claims against that shared view and other available context. When matchesModelView is false or null, legacy storage, redaction or judge-budget clipping may have omitted evidence the assistant received: missing text is not proof that the assistant invented it. Look for support or contradictions in other available sources. If the relevant model evidence was omitted, state that grounding cannot be determined instead of asserting fabrication from absence alone. Incomplete evidence also does not prove a claim verified. Keep uncertainty explicit, and still fail visible contradictions and claims unsupported by the available complete model evidence. Assess the requested outcome and other checks normally.";

/** Tell the judge where its audit view can be smaller than the model's view. */
export function judgeEvidenceVisibility(
  capability: string,
  value: unknown,
  shown: string,
): { complete: boolean; matchesModelView: boolean | null; reasons: string[] } {
  const reasons: string[] = [];
  let matchesModelView: boolean | null = null;
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (capability === "web_search" || capability === "web_fetch") {
    const output = record?.output;
    if (isSokoBotWebEvidence(output)) {
      matchesModelView = true;
      if (output.evidence.redacted) reasons.push("redacted_web_output");
      if (output.evidence.truncated) reasons.push("truncated_web_output");
    } else {
      matchesModelView = false;
      reasons.push("legacy_web_output");
    }
  }
  if (record?.truncated === true) reasons.push("stored_result_truncated");
  const full =
    typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  if (shown !== full) {
    matchesModelView = false;
    reasons.push("judge_budget_clipped");
  }
  if (full.includes("[Sensitive value removed]"))
    reasons.push("redacted_value");
  return { complete: reasons.length === 0, matchesModelView, reasons };
}
