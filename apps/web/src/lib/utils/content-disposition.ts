export function parseContentDispositionFilename(
  disposition: string | null,
): string | null {
  if (!disposition) return null;
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(
    disposition,
  );
  const value = decodeURIComponent(match?.[1] ?? match?.[2] ?? "");
  return value || null;
}
