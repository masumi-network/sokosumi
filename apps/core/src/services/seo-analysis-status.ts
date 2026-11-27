/**
 * The status a reader sees for a check. Core marks a check completed or failed when its result arrives; until
 * then its Task tells whether it runs or ended without a result.
 */
export function seoAnalysisStatus(stored: string, taskStatus?: string) {
  if (stored === "completed" || stored === "failed") return stored;
  if (taskStatus === "FAILED" || taskStatus === "CANCELED") return "failed";
  if (taskStatus === "RUNNING" || taskStatus === "COMPLETED") return "running";
  return stored;
}
