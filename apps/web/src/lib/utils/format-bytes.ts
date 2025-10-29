export function formatBytes(bytes?: number | bigint | null): string {
  if (bytes === undefined || bytes === null) return "";
  const value = typeof bytes === "bigint" ? Number(bytes) : bytes;
  if (!Number.isFinite(value)) return "";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const index = Math.floor(Math.log(value) / Math.log(1024));
  const normalized = value / 1024 ** index;
  const fixed = normalized.toFixed(index ? 1 : 0);
  return `${fixed} ${units[index]}`;
}
