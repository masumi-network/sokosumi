export function makeJobStatusChannel(jobId: string): string {
  return `job:${jobId}`;
}
