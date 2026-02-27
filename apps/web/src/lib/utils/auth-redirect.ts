export function getValidAuthRedirectUrl(
  returnUrl: string | undefined,
  fallback: string = "/",
): string {
  if (!returnUrl) {
    return fallback;
  }

  try {
    const parsedUrl = new URL(returnUrl, window.location.origin);
    return parsedUrl.origin === window.location.origin ? returnUrl : fallback;
  } catch {
    return fallback;
  }
}
