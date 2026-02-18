export function parseContentDispositionFilename(
  disposition: string | null,
): string | undefined {
  if (!disposition) return undefined;

  const encodedMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const encodedFileName = encodedMatch?.[1];
  if (encodedFileName) {
    try {
      return decodeURIComponent(encodedFileName);
    } catch {
      return encodedFileName;
    }
  }

  const plainMatch = /filename="?([^";]+)"?/i.exec(disposition);
  const plainFileName = plainMatch?.[1];
  return plainFileName || undefined;
}
