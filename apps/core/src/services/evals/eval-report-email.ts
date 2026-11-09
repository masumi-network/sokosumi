import { sendEmail } from "@/clients/email.client";
import { getEnv, getWebAppBaseUrl } from "@/config/env";
import { getEvalRunReport } from "./eval-runs.service";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * After the daily run: one email to `EVALS_REPORT_EMAILS` when a case
 * regressed, naming the cases and the PR the run came after. A run with no
 * regression sends nothing, so an email always means something.
 */
export async function sendEvalRegressionEmail(runId: string): Promise<boolean> {
  const recipients = (getEnv().EVALS_REPORT_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
  if (recipients.length === 0) return false;
  const report = await getEvalRunReport(runId);
  const regressed = report.cases.filter(
    (evalCase) => evalCase.outcome === "regressed",
  );
  if (regressed.length === 0) return false;
  const url = new URL(
    `/admin/evals/runs/${runId}`,
    getWebAppBaseUrl(),
  ).toString();
  const after = report.run.prNumber
    ? `#${report.run.prNumber}`
    : (report.run.commitSha?.slice(0, 7) ?? "main");
  const reason = (evalCase: (typeof regressed)[number]) => {
    for (const result of evalCase.results) {
      const checks = Array.isArray(result.checks)
        ? (result.checks as { label: string; pass: boolean; actual: string }[])
        : [];
      const failed = checks.find((check) => !check.pass);
      if (failed) return `${failed.label}: ${failed.actual}`;
    }
    return evalCase.results.find((result) => result.error)?.error ?? "";
  };
  const lines = regressed.map(
    (evalCase) =>
      `${evalCase.title} (${evalCase.caseId}): ${Math.round((evalCase.passRate ?? 0) * 100)}%, was ${Math.round((evalCase.baselinePassRate ?? 0) * 100)}%. ${reason(evalCase).slice(0, 200)}`,
  );
  const subject = `Evals: ${regressed.length} ${regressed.length === 1 ? "case" : "cases"} regressed after ${after}`;
  await sendEmail({
    to: recipients,
    subject,
    tag: "eval-regression",
    idempotencyKey: `eval-regression:${runId}`,
    text: [subject, "", ...lines, "", url].join("\n"),
    html: `<p>${escapeHtml(subject)}</p><ul>${lines
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join("")}</ul><p><a href="${escapeHtml(url)}">Open the run</a></p>`,
  });
  return true;
}
