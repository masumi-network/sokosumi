/**
 * Chrome-free Suspense fallback while workspace inventory resolves.
 * Must not render sidebar/header — AC: not-ready users never see app chrome.
 */
export function AppAccessCheckingFallback() {
  return (
    <div
      className="flex min-h-svh flex-1 items-center justify-center"
      data-app-access-checking
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Checking workspace access</span>
    </div>
  );
}
