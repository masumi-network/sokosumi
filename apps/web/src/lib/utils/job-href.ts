/**
 * Canonical app path for a Job detail page.
 * History, notifications, projects, lists, and post-hire navigation use this.
 */
export function buildJobHref(jobId: string): string {
  return `/jobs/${encodeURIComponent(jobId)}`;
}
