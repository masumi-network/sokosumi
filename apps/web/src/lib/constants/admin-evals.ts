export const ADMIN_EVALS_ROUTE = "/admin/evals";

export function adminEvalRunHref(runId: string): string {
  return `${ADMIN_EVALS_ROUTE}/runs/${runId}`;
}

export function adminEvalCaseHref(runId: string, caseId: string): string {
  return `${adminEvalRunHref(runId)}/cases/${encodeURIComponent(caseId)}`;
}

export const GITHUB_REPOSITORY_URL =
  "https://github.com/masumi-network/sokosumi";
